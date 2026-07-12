import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CadCommand, SketchConstraint, SketchFeature } from '@swalha-cad/document';
import { parseCadCommand } from '@swalha-cad/document';
import type { DocumentSession } from '../document-session.js';
import { runTool, toolErrorResult, toolJsonResult } from '../tool-result.js';
import { findSketch, solveSketchReport, validateProspectiveCommand } from './feature-helpers.js';

/**
 * A new constraint (its id is assigned by the server). Covers every constraint
 * M2 supports: coincident, horizontal, vertical, distance, radius, angle.
 */
const constraintInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('coincident'), pointA: z.string().min(1), pointB: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('horizontal'), lineId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('vertical'), lineId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('distance'), pointA: z.string().min(1), pointB: z.string().min(1), value: z.number() }).strict(),
  z.object({ kind: z.literal('radius'), circleId: z.string().min(1), value: z.number() }).strict(),
  z.object({ kind: z.literal('angle'), lineA: z.string().min(1), lineB: z.string().min(1), valueDeg: z.number() }).strict(),
]);

export const addConstraintInputShape = {
  sketchId: z.string().min(1),
  constraint: constraintInputSchema,
};

/**
 * Registers `add_constraint`: appends one geometric/dimensional constraint to a
 * sketch and re-solves it, mirroring the browser's `applyConstraint`. The
 * constraint is validated against the canonical schema (dimension ranges,
 * reference kinds) and the solver:
 *  - an invalid reference/dimension → structured `invalid_constraint` error;
 *  - a contradictory constraint set → structured `solver_conflict` error;
 *  - otherwise the solved geometry is adopted and persisted, and the tool
 *    returns the resulting solve status (`under-constrained` / `fully-constrained`).
 * A rejected constraint never mutates the document.
 */
export function registerAddConstraintTool(server: McpServer, session: DocumentSession): void {
  server.registerTool(
    'add_constraint',
    {
      title: 'Add constraint',
      description:
        'Add a coincident, horizontal, vertical, distance, radius, or angle constraint to a sketch, then re-solve. Rejects invalid references and contradictory constraints.',
      inputSchema: addConstraintInputShape,
    },
    (args) =>
      runTool(async () => {
        const lookup = findSketch(session.getDocument(), args.sketchId);
        if (!lookup.ok) return toolErrorResult(lookup.code, lookup.message);

        const constraint: SketchConstraint = { id: session.nextId(), ...args.constraint };
        const candidate: SketchFeature = { ...lookup.sketch, constraints: [...lookup.sketch.constraints, constraint] };

        // Schema-validate the constraint (dimension ranges, reference kinds) against
        // the whole candidate sketch before any numeric work.
        const referenceCheck = validateProspectiveCommand(session.getDocument(), {
          type: 'feature.update',
          id: args.sketchId,
          patch: { constraints: candidate.constraints },
        });
        if (!referenceCheck.ok) {
          return toolErrorResult('invalid_constraint', referenceCheck.message);
        }

        const report = solveSketchReport(candidate);
        if (!report.valid) {
          return toolErrorResult('invalid_constraint', diagnosticMessage('Constraint could not be applied', report.diagnostics));
        }
        if (report.status === 'conflicting') {
          return toolErrorResult('solver_conflict', diagnosticMessage('Constraint conflicts with existing constraints', report.diagnostics));
        }

        // Adopt the solved geometry (the solver may have moved points to satisfy the constraint).
        const command: CadCommand = {
          type: 'feature.update',
          id: args.sketchId,
          patch: { constraints: candidate.constraints, entities: report.solvedSketch.entities },
        };
        const validation = parseCadCommand(command);
        if (!validation.success) {
          return toolErrorResult('invalid_constraint', validation.error.message);
        }
        const prospective = validateProspectiveCommand(session.getDocument(), command);
        if (!prospective.ok) {
          return toolErrorResult('invalid_document', prospective.message);
        }

        const document = await session.applyCommand(command);
        const feature = document.features.find((entry) => entry.id === args.sketchId);
        return toolJsonResult({
          feature,
          constraint,
          solve: {
            status: report.status,
            remainingDof: report.remainingDof,
            diagnostics: report.diagnostics,
          },
        });
      }),
  );
}

function diagnosticMessage(prefix: string, diagnostics: readonly { message: string }[]): string {
  if (diagnostics.length === 0) return `${prefix}.`;
  return `${prefix}: ${diagnostics.map((diagnostic) => diagnostic.message).join('; ')}`;
}
