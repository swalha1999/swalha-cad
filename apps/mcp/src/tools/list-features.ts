import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CadFeature } from '@swalha-cad/document';
import {
  computeMeshBounds,
  detectSketchProfile,
  evaluateDocument,
  triangleCount,
  vertexCount,
} from '@swalha-cad/geometry';
import type { DocumentSession } from '../document-session.js';
import { runTool, toolErrorResult, toolJsonResult } from '../tool-result.js';
import { solveSketchReport } from './feature-helpers.js';

/** A compact summary row so an agent can obtain stable feature ids without dumping full geometry. */
function summarize(feature: CadFeature) {
  if (feature.kind === 'sketch') {
    return {
      id: feature.id,
      kind: feature.kind,
      name: feature.name,
      plane: feature.plane,
      entityCount: feature.entities.length,
      constraintCount: feature.constraints.length,
      visible: feature.visible,
    };
  }
  return {
    id: feature.id,
    kind: feature.kind,
    name: feature.name,
    sketchId: feature.sketchId,
    depth: feature.depth,
    direction: feature.direction,
    reverse: feature.reverse ?? false,
    visible: feature.visible,
  };
}

/** Registers `list_features`: a read-only snapshot summary of every feature (sketches and extrudes). */
export function registerListFeaturesTool(server: McpServer, session: DocumentSession): void {
  server.registerTool(
    'list_features',
    {
      title: 'List features',
      description: 'List every feature (sketch and extrude) in the document with stable ids and a compact summary.',
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        return toolJsonResult({ features: session.getDocument().features.map(summarize) });
      }),
  );
}

export const getFeatureInputShape = {
  id: z.string().min(1),
};

/**
 * Registers `get_feature`: returns a feature's full data plus diagnostics an
 * agent needs to reason about it — for a sketch, its solve status and detected
 * profile (or the topology issues blocking one); for an extrude, its evaluated
 * mesh statistics or the evaluation diagnostic explaining why it failed.
 */
export function registerGetFeatureTool(server: McpServer, session: DocumentSession): void {
  server.registerTool(
    'get_feature',
    {
      title: 'Get feature',
      description: 'Inspect a single feature by id, including sketch solve status and profile diagnostics or extrude mesh statistics.',
      inputSchema: getFeatureInputShape,
    },
    (args) =>
      runTool(async () => {
        const document = session.getDocument();
        const feature = document.features.find((candidate) => candidate.id === args.id);
        if (!feature) {
          return toolErrorResult('feature_not_found', `No feature with id "${args.id}".`);
        }

        if (feature.kind === 'sketch') {
          const report = solveSketchReport(feature);
          const profile = detectSketchProfile(feature);
          return toolJsonResult({
            feature,
            solve: {
              status: report.status,
              remainingDof: report.remainingDof,
              converged: report.converged,
              diagnostics: report.diagnostics,
            },
            profile: profile.ok ? { ok: true, profile: profile.profile } : { ok: false, issues: profile.issues },
          });
        }

        const evaluated = evaluateDocument(document);
        const body = evaluated.bodies.find((candidate) => candidate.id === feature.id);
        const diagnostic = evaluated.diagnostics.find((candidate) => candidate.featureId === feature.id);
        const mesh = body && body.geometry.kind === 'mesh' ? body.geometry.mesh : null;
        return toolJsonResult({
          feature,
          evaluation: {
            built: mesh !== null,
            triangleCount: mesh ? triangleCount(mesh) : 0,
            vertexCount: mesh ? vertexCount(mesh) : 0,
            bounds: mesh ? computeMeshBounds(mesh) : null,
            diagnostic: diagnostic ?? null,
          },
        });
      }),
  );
}
