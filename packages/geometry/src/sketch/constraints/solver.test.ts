import type { SketchConstraint, SketchEntity, SketchFeature } from '@swalha-cad/document';
import { describe, expect, it } from 'vitest';
import { solveSketch } from './solver.js';

function point(id: string, x: number, y: number, construction = false): SketchEntity {
  return { id, kind: 'point', x, y, construction };
}
function line(id: string, startId: string, endId: string, construction = false): SketchEntity {
  return { id, kind: 'line', startId, endId, construction };
}
function circle(id: string, centerId: string, radius: number, construction = false): SketchEntity {
  return { id, kind: 'circle', centerId, radius, construction };
}
function sketch(entities: SketchEntity[], constraints: SketchConstraint[]): SketchFeature {
  return { id: 'sketch1', kind: 'sketch', name: 'Sketch 1', plane: 'XY', entities, constraints, visible: true };
}

function pointOf(feature: SketchFeature, id: string): Extract<SketchEntity, { kind: 'point' }> {
  const entity = feature.entities.find((e) => e.id === id);
  if (!entity || entity.kind !== 'point') throw new Error(`No point ${id}`);
  return entity;
}
function circleOf(feature: SketchFeature, id: string): Extract<SketchEntity, { kind: 'circle' }> {
  const entity = feature.entities.find((e) => e.id === id);
  if (!entity || entity.kind !== 'circle') throw new Error(`No circle ${id}`);
  return entity;
}
function distance(feature: SketchFeature, a: string, b: string): number {
  const pa = pointOf(feature, a);
  const pb = pointOf(feature, b);
  return Math.hypot(pb.x - pa.x, pb.y - pa.y);
}
/** Signed angle (degrees) from line a to line b, matching the solver's convention. */
function signedAngleDeg(feature: SketchFeature, lineA: [string, string], lineB: [string, string]): number {
  const a0 = pointOf(feature, lineA[0]);
  const a1 = pointOf(feature, lineA[1]);
  const b0 = pointOf(feature, lineB[0]);
  const b1 = pointOf(feature, lineB[1]);
  const theta = Math.atan2(b1.y - b0.y, b1.x - b0.x) - Math.atan2(a1.y - a0.y, a1.x - a0.x);
  return (Math.atan2(Math.sin(theta), Math.cos(theta)) * 180) / Math.PI;
}

describe('solveSketch — single constraints', () => {
  it('coincident merges two points', () => {
    const result = solveSketch(sketch([point('p0', 0, 0), point('p1', 3, 4)], [{ id: 'c', kind: 'coincident', pointA: 'p0', pointB: 'p1' }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('under-constrained');
    expect(distance(result.sketch, 'p0', 'p1')).toBeCloseTo(0, 9);
  });

  it('horizontal levels a line', () => {
    const result = solveSketch(sketch([point('p0', 0, 0), point('p1', 3, 4), line('l0', 'p0', 'p1')], [{ id: 'c', kind: 'horizontal', lineId: 'l0' }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pointOf(result.sketch, 'p0').y).toBeCloseTo(pointOf(result.sketch, 'p1').y, 9);
  });

  it('vertical plumbs a line', () => {
    const result = solveSketch(sketch([point('p0', 0, 0), point('p1', 3, 4), line('l0', 'p0', 'p1')], [{ id: 'c', kind: 'vertical', lineId: 'l0' }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pointOf(result.sketch, 'p0').x).toBeCloseTo(pointOf(result.sketch, 'p1').x, 9);
  });

  it('distance stretches a point pair to the target length', () => {
    const result = solveSketch(sketch([point('p0', 0, 0), point('p1', 3, 0)], [{ id: 'c', kind: 'distance', pointA: 'p0', pointB: 'p1', value: 10 }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(distance(result.sketch, 'p0', 'p1')).toBeCloseTo(10, 9);
  });

  it('radius sets a circle radius', () => {
    const result = solveSketch(sketch([point('c0', 0, 0), circle('circ', 'c0', 5)], [{ id: 'c', kind: 'radius', circleId: 'circ', value: 12 }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(circleOf(result.sketch, 'circ').radius).toBeCloseTo(12, 9);
  });

  it('angle rotates one line to the target angle from another', () => {
    const result = solveSketch(
      sketch(
        [point('a0', 0, 0), point('a1', 1, 0), point('b0', 0, 0), point('b1', 1, 0), line('la', 'a0', 'a1'), line('lb', 'b0', 'b1')],
        [{ id: 'c', kind: 'angle', lineA: 'la', lineB: 'lb', valueDeg: 90 }],
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Math.abs(signedAngleDeg(result.sketch, ['a0', 'a1'], ['b0', 'b1']))).toBeCloseTo(90, 6);
  });
});

/** Slightly-off rectangle so the solver has real work to do. p0..p3 counter-clockwise. */
function skewedRectangle(): SketchEntity[] {
  return [
    point('p0', 0.1, -0.2),
    point('p1', 4.3, 0.4),
    point('p2', 3.9, 2.2),
    point('p3', -0.3, 1.7),
    line('l0', 'p0', 'p1'),
    line('l1', 'p1', 'p2'),
    line('l2', 'p2', 'p3'),
    line('l3', 'p3', 'p0'),
  ];
}
function rectangleConstraints(): SketchConstraint[] {
  return [
    { id: 'h0', kind: 'horizontal', lineId: 'l0' },
    { id: 'v1', kind: 'vertical', lineId: 'l1' },
    { id: 'h2', kind: 'horizontal', lineId: 'l2' },
    { id: 'v3', kind: 'vertical', lineId: 'l3' },
    { id: 'dw', kind: 'distance', pointA: 'p0', pointB: 'p1', value: 4 },
    { id: 'dh', kind: 'distance', pointA: 'p1', pointB: 'p2', value: 2 },
  ];
}

describe('solveSketch — rectangles', () => {
  it('solves a combined dimensioned rectangle but reports it under-constrained without an anchor', () => {
    const result = solveSketch(sketch(skewedRectangle(), rectangleConstraints()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('under-constrained');
    // Free rigid-body translation remains (orientation locked by h/v constraints).
    expect(result.remainingDof).toBe(2);
    expect(distance(result.sketch, 'p0', 'p1')).toBeCloseTo(4, 6);
    expect(distance(result.sketch, 'p1', 'p2')).toBeCloseTo(2, 6);
    expect(Math.abs(signedAngleDeg(result.sketch, ['p0', 'p1'], ['p1', 'p2']))).toBeCloseTo(90, 6);
  });

  it('reports an anchored fully dimensioned rectangle as fully-constrained', () => {
    const result = solveSketch(sketch(skewedRectangle(), rectangleConstraints()), { anchoredPointIds: ['p0'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('fully-constrained');
    expect(result.remainingDof).toBe(0);
    // Anchor stays put; corners snap to an exact 4x2 rectangle.
    expect(pointOf(result.sketch, 'p0').x).toBeCloseTo(0.1, 9);
    expect(pointOf(result.sketch, 'p0').y).toBeCloseTo(-0.2, 9);
    expect(distance(result.sketch, 'p0', 'p1')).toBeCloseTo(4, 6);
    expect(distance(result.sketch, 'p1', 'p2')).toBeCloseTo(2, 6);
    expect(distance(result.sketch, 'p2', 'p3')).toBeCloseTo(4, 6);
    expect(distance(result.sketch, 'p3', 'p0')).toBeCloseTo(2, 6);
  });
});

describe('solveSketch — status classification', () => {
  it('reports an unconstrained sketch as under-constrained', () => {
    const result = solveSketch(sketch([point('p0', 1, 2)], []));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.converged).toBe(true);
    expect(result.status).toBe('under-constrained');
    expect(result.remainingDof).toBe(2);
  });

  it('reports contradictory constraints as conflicting and rolls back geometry', () => {
    const entities = [point('p0', 0, 0), point('p1', 3, 0)];
    const result = solveSketch(
      sketch(entities, [
        { id: 'd5', kind: 'distance', pointA: 'p0', pointB: 'p1', value: 5 },
        { id: 'd10', kind: 'distance', pointA: 'p0', pointB: 'p1', value: 10 },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('conflicting');
    expect(result.converged).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    // Rollback: coordinates are exactly the untouched input.
    expect(pointOf(result.sketch, 'p1').x).toBe(3);
    expect(pointOf(result.sketch, 'p1').y).toBe(0);
  });

  it('reports a geometrically impossible triangle as conflicting (non-convergence)', () => {
    const result = solveSketch(
      sketch([point('a', 0, 0), point('b', 1, 0), point('c', 2, 0)], [
        { id: 'dab', kind: 'distance', pointA: 'a', pointB: 'b', value: 1 },
        { id: 'dbc', kind: 'distance', pointA: 'b', pointB: 'c', value: 1 },
        { id: 'dac', kind: 'distance', pointA: 'a', pointB: 'c', value: 10 },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('conflicting');
    expect(result.converged).toBe(false);
  });
});

describe('solveSketch — validation', () => {
  it('rejects a constraint referencing a missing point', () => {
    const result = solveSketch(sketch([point('p0', 0, 0)], [{ id: 'c', kind: 'distance', pointA: 'p0', pointB: 'ghost', value: 1 }]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe('invalid');
    expect(result.diagnostics.some((d) => d.code === 'missing-reference')).toBe(true);
  });

  it('rejects a non-finite coordinate', () => {
    const result = solveSketch(sketch([point('p0', Number.NaN, 0)], []));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((d) => d.code === 'non-finite-input')).toBe(true);
  });

  it('rejects a negative distance dimension', () => {
    const result = solveSketch(sketch([point('p0', 0, 0), point('p1', 1, 0)], [{ id: 'c', kind: 'distance', pointA: 'p0', pointB: 'p1', value: -5 }]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((d) => d.code === 'invalid-dimension')).toBe(true);
  });

  it('rejects an anchor on a missing point', () => {
    const result = solveSketch(sketch([point('p0', 0, 0)], []), { anchoredPointIds: ['ghost'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((d) => d.code === 'invalid-anchor')).toBe(true);
  });
});

describe('solveSketch — determinism and tolerance', () => {
  it('produces identical results across repeated solves', () => {
    const build = () => solveSketch(sketch(skewedRectangle(), rectangleConstraints()), { anchoredPointIds: ['p0'] });
    const first = build();
    const second = build();
    expect(first).toEqual(second);
    if (!first.ok) return;
    expect(first.sketch.entities).toEqual(second.ok ? second.sketch.entities : null);
  });

  it('is unaffected by input constraint ordering', () => {
    const forward = solveSketch(sketch(skewedRectangle(), rectangleConstraints()), { anchoredPointIds: ['p0'] });
    const reversed = solveSketch(sketch(skewedRectangle(), [...rectangleConstraints()].reverse()), { anchoredPointIds: ['p0'] });
    expect(forward.ok && reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) return;
    expect(reversed.sketch.entities).toEqual(forward.sketch.entities);
  });

  it('drives the largest residual below the requested tolerance', () => {
    const tolerance = 1e-8;
    const result = solveSketch(sketch(skewedRectangle(), rectangleConstraints()), { anchoredPointIds: ['p0'], tolerance });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.converged).toBe(true);
    expect(result.residualNorm).toBeLessThanOrEqual(tolerance);
  });

  it('declares non-convergence when the iteration budget is exhausted', () => {
    const result = solveSketch(sketch([point('p0', 0, 0), point('p1', 3, 0)], [{ id: 'c', kind: 'distance', pointA: 'p0', pointB: 'p1', value: 10 }]), {
      maxIterations: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('conflicting');
    expect(result.converged).toBe(false);
  });

  it('never mutates the input sketch', () => {
    const entities = skewedRectangle();
    const input = sketch(entities, rectangleConstraints());
    const snapshot = JSON.stringify(input);
    solveSketch(input, { anchoredPointIds: ['p0'] });
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
