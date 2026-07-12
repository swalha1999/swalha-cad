import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CadCommand } from '@swalha-cad/document';
import { parseCadCommand } from '@swalha-cad/document';
import type { DocumentSession } from '../document-session.js';
import { runTool, toolErrorResult, toolJsonResult } from '../tool-result.js';
import { findSketch, solveSketchReport, validateProspectiveCommand } from './feature-helpers.js';

export const solveSketchInputShape = {
  sketchId: z.string().min(1),
  /** When true (the default), the solved point/radius geometry is written back to the sketch. */
  persist: z.boolean().optional(),
};

/**
 * Registers `solve_sketch`: runs the deterministic constraint solver on a
 * sketch (grounded on its first point) and reports its status —
 * `under-constrained`, `fully-constrained`, `conflicting`, or `invalid` — with
 * structured diagnostics and solver metrics. Unless `persist` is false, the
 * solved geometry is written back through a `feature.update` command (skipped
 * for a conflicting/invalid solve, which never mutates the document).
 */
export function registerSolveSketchTool(server: McpServer, session: DocumentSession): void {
  server.registerTool(
    'solve_sketch',
    {
      title: 'Solve sketch',
      description:
        'Solve a sketch and report its constraint status (under-constrained / fully-constrained / conflicting / invalid) with diagnostics. Persists the solved geometry unless persist is false.',
      inputSchema: solveSketchInputShape,
    },
    (args) =>
      runTool(async () => {
        const lookup = findSketch(session.getDocument(), args.sketchId);
        if (!lookup.ok) return toolErrorResult(lookup.code, lookup.message);

        const report = solveSketchReport(lookup.sketch);
        const persist = args.persist ?? true;
        // Only converged, non-conflicting solves have geometry worth adopting.
        const shouldPersist =
          persist && report.valid && report.status !== 'conflicting' && report.solvedSketch !== lookup.sketch;

        let persisted = false;
        if (shouldPersist) {
          const command: CadCommand = { type: 'feature.update', id: args.sketchId, patch: { entities: report.solvedSketch.entities } };
          const validation = parseCadCommand(command);
          if (!validation.success) {
            return toolErrorResult('invalid_document', validation.error.message);
          }
          const prospective = validateProspectiveCommand(session.getDocument(), command);
          if (!prospective.ok) {
            return toolErrorResult('invalid_document', prospective.message);
          }
          await session.applyCommand(command);
          persisted = true;
        }

        return toolJsonResult({
          sketchId: args.sketchId,
          status: report.status,
          remainingDof: report.remainingDof,
          converged: report.converged,
          iterations: report.iterations,
          residualNorm: report.residualNorm,
          diagnostics: report.diagnostics,
          persisted,
        });
      }),
  );
}
