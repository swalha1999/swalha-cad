import type { SketchFeature } from '@swalha-cad/document';
import { compileSystem, type CompiledSystem } from './equations.js';
import { classifyStatus, matrixRank } from './status.js';
import type { SolveResult, SolveOptions } from './types.js';

const DEFAULT_MAX_ITERATIONS = 128;
const DEFAULT_TOLERANCE = 1e-9;
const INITIAL_DAMPING = 1e-3;
const MIN_DAMPING = 1e-12;
const MAX_DAMPING = 1e12;
/** Per-iteration cap on damping increases before we give up on that step. */
const MAX_DAMPING_STEPS = 40;

/** Largest absolute component of a vector — the infinity norm used for the convergence test. */
function maxAbs(values: readonly number[]): number {
  let max = 0;
  for (const value of values) {
    const abs = Math.abs(value);
    if (abs > max) max = abs;
  }
  return max;
}

/** Euclidean (L2) norm, reported to callers as the residual magnitude. */
function l2Norm(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) sum += value * value;
  return Math.sqrt(sum);
}

/**
 * Solves the dense linear system `A x = b` by Gaussian elimination with
 * partial pivoting. Returns `null` when `A` is singular to working precision.
 * `A` is mutated in place, so callers pass a throwaway copy.
 */
function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotMag = Math.abs(a[col]![col]!);
    for (let r = col + 1; r < n; r++) {
      const mag = Math.abs(a[r]![col]!);
      if (mag > pivotMag) {
        pivotMag = mag;
        pivotRow = r;
      }
    }
    if (pivotMag < 1e-14) return null;
    if (pivotRow !== col) {
      [a[col], a[pivotRow]] = [a[pivotRow]!, a[col]!];
      [b[col], b[pivotRow]] = [b[pivotRow]!, b[col]!];
    }
    const pivot = a[col]![col]!;
    for (let r = col + 1; r < n; r++) {
      const factor = a[r]![col]! / pivot;
      if (factor === 0) continue;
      for (let c = col; c < n; c++) a[r]![c]! -= factor * a[col]![c]!;
      b[r]! -= factor * b[col]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row]!;
    for (let c = row + 1; c < n; c++) sum -= a[row]![c]! * x[c]!;
    x[row] = sum / a[row]![row]!;
  }
  return x;
}

/** Builds `JᵀJ` (Gauss-Newton approximate Hessian) and `Jᵀr` (gradient) in one pass. */
function normalEquations(jacobian: readonly number[][], residuals: readonly number[], n: number): { hessian: number[][]; gradient: number[] } {
  const hessian: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const gradient = new Array<number>(n).fill(0);
  for (let row = 0; row < jacobian.length; row++) {
    const jr = jacobian[row]!;
    const res = residuals[row]!;
    for (let i = 0; i < n; i++) {
      const jri = jr[i]!;
      if (jri === 0) continue;
      gradient[i]! += jri * res;
      for (let j = i; j < n; j++) {
        hessian[i]![j]! += jri * jr[j]!;
      }
    }
  }
  // Mirror the symmetric upper triangle into the lower.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) hessian[j]![i]! = hessian[i]![j]!;
  }
  return { hessian, gradient };
}

interface Converged {
  readonly x: number[];
  readonly converged: boolean;
  readonly iterations: number;
  readonly residualNorm: number;
}

/**
 * Damped Gauss-Newton (Levenberg-Marquardt) iteration over the compiled system.
 * Bounded by `maxIterations`; adapts the damping `lambda` up on rejected steps
 * and down on accepted ones. Deterministic: no randomness and a fixed starting
 * damping, so the same input always traces the same path.
 */
function runGaussNewton(system: CompiledSystem, maxIterations: number, tolerance: number): Converged {
  const n = system.variables.length;
  let x = [...system.initial];
  const initialResiduals = system.evaluate(x).residuals;
  let cost = l2Norm(initialResiduals);
  let lambda = INITIAL_DAMPING;

  if (n === 0 || maxAbs(initialResiduals) <= tolerance) {
    return { x, converged: maxAbs(initialResiduals) <= tolerance, iterations: 0, residualNorm: cost };
  }

  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    const { residuals: r, jacobian } = system.evaluate(x);
    if (maxAbs(r) <= tolerance) break;
    const { hessian, gradient } = normalEquations(jacobian, r, n);

    let stepped = false;
    for (let attempt = 0; attempt < MAX_DAMPING_STEPS; attempt++) {
      const a = hessian.map((row, i) => row.map((value, j) => (i === j ? value + lambda : value)));
      const negGradient = gradient.map((g) => -g);
      const delta = solveLinear(a, negGradient);
      if (delta === null) {
        lambda = Math.min(lambda * 4, MAX_DAMPING);
        if (lambda >= MAX_DAMPING) break;
        continue;
      }
      const candidate = x.map((value, i) => value + delta[i]!);
      const candidateResiduals = system.evaluate(candidate).residuals;
      const candidateCost = l2Norm(candidateResiduals);
      if (candidateCost < cost) {
        x = candidate;
        cost = candidateCost;
        lambda = Math.max(lambda * 0.3, MIN_DAMPING);
        stepped = true;
        break;
      }
      lambda = Math.min(lambda * 4, MAX_DAMPING);
      if (lambda >= MAX_DAMPING) break;
    }
    if (!stepped) {
      // No damping value produced a decrease: the iteration has stalled.
      iterations++;
      break;
    }
  }

  const finalResiduals = system.evaluate(x).residuals;
  const residualNorm = l2Norm(finalResiduals);
  return { x, converged: maxAbs(finalResiduals) <= tolerance, iterations, residualNorm };
}

/**
 * Solves a sketch's supported V2 constraints and reports its constraint state.
 *
 * The input sketch is never mutated. On a `conflicting` (non-convergent) solve
 * the returned `sketch` is the original, unchanged geometry — the solver never
 * emits partially moved points. On a converged solve the returned `sketch` is
 * a fresh copy with solved point coordinates and circle radii.
 */
export function solveSketch(sketch: SketchFeature, options: SolveOptions = {}): SolveResult {
  const anchoredPointIds = options.anchoredPointIds ?? [];
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;

  const compiled = compileSystem(sketch, anchoredPointIds);
  if (!compiled.ok) {
    return { ok: false, status: 'invalid', sketch, diagnostics: compiled.diagnostics };
  }

  const system = compiled.system;
  const result = runGaussNewton(system, maxIterations, tolerance);

  if (!result.converged) {
    // Rollback: report the untouched input geometry, no partial mutation.
    return {
      ok: true,
      status: 'conflicting',
      sketch,
      converged: false,
      iterations: result.iterations,
      residualNorm: result.residualNorm,
      remainingDof: Math.max(0, system.variables.length - matrixRank(system.evaluate(result.x).jacobian)),
      diagnostics: [
        {
          code: result.residualNorm > tolerance ? 'conflict' : 'non-convergence',
          message: 'Constraints could not be satisfied simultaneously; the sketch is over- or contradictorily constrained.',
          constraintIds: [...sketch.constraints].map((constraint) => constraint.id).sort(),
          entityIds: [],
        },
      ],
    };
  }

  const rank = matrixRank(system.evaluate(result.x).jacobian);
  const { status, remainingDof } = classifyStatus({
    converged: true,
    variableCount: system.variables.length,
    rank,
  });

  const solvedEntities = system.buildEntities(result.x);
  const solvedSketch: SketchFeature = { ...sketch, entities: solvedEntities };

  return {
    ok: true,
    status,
    sketch: solvedSketch,
    converged: true,
    iterations: result.iterations,
    residualNorm: result.residualNorm,
    remainingDof,
    diagnostics: [],
  };
}
