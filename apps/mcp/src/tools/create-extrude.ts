import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CadCommand, ExtrudeFeature } from '@swalha-cad/document';
import { parseCadCommand } from '@swalha-cad/document';
import { computeMeshBounds, extrudeSketch, triangleCount, vertexCount } from '@swalha-cad/geometry';
import type { DocumentSession } from '../document-session.js';
import { runTool, toolErrorResult, toolJsonResult } from '../tool-result.js';
import { findSketch, nextFeatureName, validateProspectiveCommand } from './feature-helpers.js';

export const createExtrudeInputShape = {
  sketchId: z.string().min(1),
  depth: z.number(),
  direction: z.enum(['normal', 'symmetric']).optional(),
  reverse: z.boolean().optional(),
  name: z.string().min(1).optional(),
  /** When set, updates the existing extrude with this id instead of creating a new one. */
  featureId: z.string().min(1).optional(),
};

/** Maps the geometry package's extrude error code to a stable MCP error code. */
const EXTRUDE_ERROR_CODES: Record<string, string> = {
  'invalid-depth': 'invalid_depth',
  'invalid-profile': 'invalid_profile',
  'degenerate-profile': 'degenerate_profile',
};

/**
 * Registers `create_or_update_extrude`: sweeps a sketch's single closed profile
 * into a solid, mirroring the browser's extrude workflow. Creates a new extrude
 * feature, or updates an existing one when `featureId` is supplied. The sketch
 * must exist and yield exactly one extrudable profile — an open, ambiguous, or
 * self-intersecting profile returns a structured topology error and never
 * mutates the document. Supports `normal` and `symmetric` sweeps (and
 * `reverse`), and validates the whole prospective document before persisting.
 */
export function registerCreateExtrudeTool(server: McpServer, session: DocumentSession): void {
  server.registerTool(
    'create_or_update_extrude',
    {
      title: 'Create or update extrude',
      description:
        'Extrude a sketch profile into a solid (normal or symmetric, optional reverse). Creates a new extrude, or updates an existing one when featureId is given.',
      inputSchema: createExtrudeInputShape,
    },
    (args) =>
      runTool(async () => {
        const document = session.getDocument();
        const direction = args.direction ?? 'normal';
        const reverse = args.reverse ?? false;

        const lookup = findSketch(document, args.sketchId);
        if (!lookup.ok) return toolErrorResult(lookup.code, lookup.message);

        // Validate the profile is extrudable up front so open/ambiguous profiles fail
        // with a topology error before any document mutation.
        const extruded = extrudeSketch(lookup.sketch, { depth: args.depth, direction, reverse });
        if (!extruded.ok) {
          const code = EXTRUDE_ERROR_CODES[extruded.error.code] ?? 'invalid_extrude';
          const issues = extruded.error.issues.map((issue) => issue.message).join('; ');
          const message = issues ? `${extruded.error.message} (${issues})` : extruded.error.message;
          return toolErrorResult(code, message);
        }

        let command: CadCommand;
        let featureId: string;
        if (args.featureId !== undefined) {
          const existing = document.features.find((candidate) => candidate.id === args.featureId);
          if (!existing) return toolErrorResult('feature_not_found', `No feature with id "${args.featureId}".`);
          if (existing.kind !== 'extrude') {
            return toolErrorResult('not_an_extrude', `Feature "${args.featureId}" is a ${existing.kind}, not an extrude.`);
          }
          featureId = existing.id;
          command = {
            type: 'feature.update',
            id: featureId,
            patch: { sketchId: args.sketchId, depth: args.depth, direction, reverse },
          };
        } else {
          featureId = session.nextId();
          const feature: ExtrudeFeature = {
            id: featureId,
            kind: 'extrude',
            name: args.name ?? nextFeatureName(document.features, 'Extrude'),
            sketchId: args.sketchId,
            depth: args.depth,
            direction,
            reverse,
            visible: true,
          };
          command = { type: 'feature.create', feature };
        }

        const validation = parseCadCommand(command);
        if (!validation.success) {
          return toolErrorResult('invalid_extrude', validation.error.message);
        }
        const prospective = validateProspectiveCommand(document, command);
        if (!prospective.ok) {
          return toolErrorResult('invalid_document', prospective.message);
        }

        const next = await session.applyCommand(command);
        const feature = next.features.find((candidate) => candidate.id === featureId);
        return toolJsonResult({
          feature,
          mesh: {
            triangleCount: triangleCount(extruded.mesh),
            vertexCount: vertexCount(extruded.mesh),
            bounds: computeMeshBounds(extruded.mesh),
          },
        });
      }),
  );
}
