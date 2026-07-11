import { describe, expect, it } from 'vitest';
import { classifyStatus, matrixRank } from './status.js';

describe('matrixRank', () => {
  it('returns 0 for an empty matrix', () => {
    expect(matrixRank([])).toBe(0);
    expect(matrixRank([[]])).toBe(0);
  });

  it('counts independent rows', () => {
    expect(
      matrixRank([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]),
    ).toBe(3);
  });

  it('ignores linearly dependent rows', () => {
    expect(
      matrixRank([
        [1, 2, 3],
        [2, 4, 6], // 2x the first row
        [0, 0, 0],
      ]),
    ).toBe(1);
  });

  it('treats near-zero pivots as rank-deficient', () => {
    expect(
      matrixRank([
        [1, 0],
        [0, 1e-12],
      ]),
    ).toBe(1);
  });
});

describe('classifyStatus', () => {
  it('is conflicting whenever the solve did not converge', () => {
    expect(classifyStatus({ converged: false, variableCount: 6, rank: 6 }).status).toBe('conflicting');
  });

  it('is fully-constrained when no degrees of freedom remain', () => {
    const result = classifyStatus({ converged: true, variableCount: 6, rank: 6 });
    expect(result.status).toBe('fully-constrained');
    expect(result.remainingDof).toBe(0);
  });

  it('is under-constrained when freedom remains', () => {
    const result = classifyStatus({ converged: true, variableCount: 8, rank: 6 });
    expect(result.status).toBe('under-constrained');
    expect(result.remainingDof).toBe(2);
  });

  it('never reports negative remaining degrees of freedom', () => {
    // Redundant (over-)constraint: rank can never exceed variableCount, but guard anyway.
    expect(classifyStatus({ converged: true, variableCount: 4, rank: 6 }).remainingDof).toBe(0);
  });
});
