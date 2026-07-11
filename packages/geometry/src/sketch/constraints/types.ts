import type { SketchFeature } from '@swalha-cad/document';

/**
 * The three constraint states M2 reports for a solved sketch. A sketch is
 * `fully-constrained` when the solver converges and no residual degrees of
 * freedom remain, `under-constrained` when it converges but geometry is still
 * free to move, and `conflicting` when the constraints cannot be satisfied
 * simultaneously (contradictory dimensions or a non-convergent system).
 */
export type SolveStatus = 'under-constrained' | 'fully-constrained' | 'conflicting';

/** Categories of problems the solver can report, split between input validation and numeric outcome. */
export type SolveDiagnosticCode =
  | 'missing-reference'
  | 'non-finite-input'
  | 'invalid-dimension'
  | 'invalid-anchor'
  | 'conflict'
  | 'non-convergence'
  | 'redundant-constraint';

/** A structured, machine-readable explanation of why a solve failed to validate, converge, or fully constrain. */
export interface SolveDiagnostic {
  readonly code: SolveDiagnosticCode;
  readonly message: string;
  readonly constraintIds: readonly string[];
  readonly entityIds: readonly string[];
}

/** Tunable, all-optional solver controls; every field has a deterministic default. */
export interface SolveOptions {
  /**
   * Point ids held fixed at their input coordinates and removed from the
   * variable set. Anchoring removes rigid-body freedom so an otherwise mobile
   * sketch can become `fully-constrained`.
   */
  readonly anchoredPointIds?: readonly string[];
  /** Maximum accepted Levenberg-Marquardt iterations before declaring non-convergence. Default 128. */
  readonly maxIterations?: number;
  /** Convergence threshold on the largest absolute constraint residual (mm or radians). Default 1e-9. */
  readonly tolerance?: number;
}

/**
 * Result of a solve that passed input validation. `sketch` holds the solved
 * geometry when `status` is `under-constrained` or `fully-constrained`; on a
 * `conflicting` result it is the untouched input sketch (rollback — the solver
 * never returns partially mutated geometry).
 */
export interface SolvedResult {
  readonly ok: true;
  readonly status: SolveStatus;
  readonly sketch: SketchFeature;
  readonly converged: boolean;
  readonly iterations: number;
  readonly residualNorm: number;
  readonly remainingDof: number;
  readonly diagnostics: readonly SolveDiagnostic[];
}

/**
 * Result of a solve rejected before any numeric work: the input referenced a
 * missing entity, carried a non-finite coordinate/dimension, or named an
 * invalid anchor. `sketch` is always the untouched input.
 */
export interface InvalidResult {
  readonly ok: false;
  readonly status: 'invalid';
  readonly sketch: SketchFeature;
  readonly diagnostics: readonly SolveDiagnostic[];
}

export type SolveResult = SolvedResult | InvalidResult;
