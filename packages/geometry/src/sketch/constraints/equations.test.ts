import type { SketchConstraint, SketchEntity, SketchFeature } from '@swalha-cad/document';
import { describe, expect, it } from 'vitest';
import { compileSystem, type CompiledSystem } from './equations.js';

function sketch(entities: SketchEntity[], constraints: SketchConstraint[] = []): SketchFeature {
  return { id: 's', kind: 'sketch', name: 'S', plane: 'XY', entities, constraints, visible: true };
}

describe('compileSystem — variable layout', () => {
  it('lays out unanchored point coordinates then circle radii in id order', () => {
    const compiled = compileSystem(
      sketch([
        { id: 'pb', kind: 'point', x: 1, y: 2, construction: false },
        { id: 'pa', kind: 'point', x: 3, y: 4, construction: false },
        { id: 'cz', kind: 'circle', centerId: 'pa', radius: 5, construction: false },
      ]),
      [],
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.system.variables.map((v) => `${v.kind}:${v.ownerId}`)).toEqual([
      'point-x:pa',
      'point-y:pa',
      'point-x:pb',
      'point-y:pb',
      'circle-r:cz',
    ]);
    expect(compiled.system.initial).toEqual([3, 4, 1, 2, 5]);
  });

  it('excludes anchored points from the variable set', () => {
    const compiled = compileSystem(
      sketch([
        { id: 'pa', kind: 'point', x: 0, y: 0, construction: false },
        { id: 'pb', kind: 'point', x: 1, y: 1, construction: false },
      ]),
      ['pa'],
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.system.variables.map((v) => v.ownerId)).toEqual(['pb', 'pb']);
  });
});

describe('compileSystem — analytic Jacobian matches finite differences', () => {
  function finiteDifference(system: CompiledSystem, x: number[]): number[][] {
    const h = 1e-6;
    const base = system.evaluate(x).residuals;
    const rows = base.length;
    const cols = x.length;
    const numeric: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
    for (let c = 0; c < cols; c++) {
      const bumped = [...x];
      bumped[c]! += h;
      const perturbed = system.evaluate(bumped).residuals;
      for (let r = 0; r < rows; r++) numeric[r]![c] = (perturbed[r]! - base[r]!) / h;
    }
    return numeric;
  }

  it('agrees for distance, radius, and angle residuals', () => {
    const compiled = compileSystem(
      sketch(
        [
          { id: 'a0', kind: 'point', x: 0.2, y: -0.3, construction: false },
          { id: 'a1', kind: 'point', x: 1.4, y: 0.5, construction: false },
          { id: 'b1', kind: 'point', x: 0.7, y: 1.1, construction: false },
          { id: 'c0', kind: 'circle', centerId: 'a0', radius: 2.5, construction: false } as SketchEntity,
          { id: 'la', kind: 'line', startId: 'a0', endId: 'a1', construction: false },
          { id: 'lb', kind: 'line', startId: 'a0', endId: 'b1', construction: false },
        ],
        [
          { id: 'd', kind: 'distance', pointA: 'a0', pointB: 'a1', value: 1 },
          { id: 'r', kind: 'radius', circleId: 'c0', value: 3 },
          { id: 'ang', kind: 'angle', lineA: 'la', lineB: 'lb', valueDeg: 30 },
        ],
      ),
      [],
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const x = [...compiled.system.initial];
    const analytic = compiled.system.evaluate(x).jacobian;
    const numeric = finiteDifference(compiled.system, x);
    for (let r = 0; r < analytic.length; r++) {
      for (let c = 0; c < analytic[r]!.length; c++) {
        expect(analytic[r]![c]!).toBeCloseTo(numeric[r]![c]!, 4);
      }
    }
  });
});
