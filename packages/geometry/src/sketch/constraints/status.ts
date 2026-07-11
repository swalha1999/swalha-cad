import type { SolveStatus } from './types.js';

/** Relative pivot threshold below which a Gaussian-elimination pivot is treated as numerically zero. */
const RANK_EPSILON = 1e-7;

/**
 * Numerical rank of a matrix via Gaussian elimination with partial pivoting.
 * Used on the constraint Jacobian at the solution to count how many of the
 * variables the constraints actually pin down; the matrix is copied so the
 * caller's rows are never mutated.
 */
export function matrixRank(matrix: readonly (readonly number[])[]): number {
  const rows = matrix.length;
  if (rows === 0) return 0;
  const cols = matrix[0]!.length;
  if (cols === 0) return 0;

  const m = matrix.map((row) => [...row]);
  let rank = 0;
  const pivotCols: number[] = [];

  for (let col = 0; col < cols && rank < rows; col++) {
    // Partial pivot: pick the largest-magnitude entry in this column at or below `rank`.
    let pivotRow = rank;
    let pivotMag = Math.abs(m[rank]![col]!);
    for (let r = rank + 1; r < rows; r++) {
      const mag = Math.abs(m[r]![col]!);
      if (mag > pivotMag) {
        pivotMag = mag;
        pivotRow = r;
      }
    }
    if (pivotMag <= RANK_EPSILON) continue;

    [m[rank], m[pivotRow]] = [m[pivotRow]!, m[rank]!];
    const pivot = m[rank]![col]!;
    for (let r = 0; r < rows; r++) {
      if (r === rank) continue;
      const factor = m[r]![col]! / pivot;
      if (factor === 0) continue;
      for (let c = col; c < cols; c++) {
        m[r]![c]! -= factor * m[rank]![c]!;
      }
    }
    pivotCols.push(col);
    rank++;
  }
  return rank;
}

/**
 * Classifies the solved sketch. A non-convergent numeric solve means the
 * constraints cannot be satisfied together, so the sketch is `conflicting`.
 * Otherwise the rank of the Jacobian at the solution tells us how many degrees
 * of freedom the constraints removed: any remaining freedom is
 * `under-constrained`, none is `fully-constrained`.
 */
export function classifyStatus(params: {
  readonly converged: boolean;
  readonly variableCount: number;
  readonly rank: number;
}): { status: SolveStatus; remainingDof: number } {
  const remainingDof = Math.max(0, params.variableCount - params.rank);
  if (!params.converged) return { status: 'conflicting', remainingDof };
  return { status: remainingDof > 0 ? 'under-constrained' : 'fully-constrained', remainingDof };
}
