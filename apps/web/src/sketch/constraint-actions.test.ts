import type { SketchEntity, SketchFeature } from '@swalha-cad/document';
import { describe, expect, it } from 'vitest';
import { buildConstraintForSelection, classifySelection, constraintEligibility, measureSignedAngleDeg } from './constraint-actions.js';

function point(id: string, x: number, y: number): SketchEntity {
  return { id, kind: 'point', x, y, construction: false };
}
function line(id: string, startId: string, endId: string): SketchEntity {
  return { id, kind: 'line', startId, endId, construction: false };
}
function circle(id: string, centerId: string, radius: number): SketchEntity {
  return { id, kind: 'circle', centerId, radius, construction: false };
}

/** A unit square p0(0,0) p1(4,0) p2(4,3) p3(0,3) with its four edges and a circle. */
function fixture(): SketchFeature {
  return {
    id: 'sketch1',
    kind: 'sketch',
    name: 'Sketch 1',
    plane: 'XY',
    entities: [
      point('p0', 0, 0),
      point('p1', 4, 0),
      point('p2', 4, 3),
      point('p3', 0, 3),
      line('l0', 'p0', 'p1'),
      line('l1', 'p1', 'p2'),
      line('l2', 'p2', 'p3'),
      line('l3', 'p3', 'p0'),
      point('c0', 10, 10),
      circle('circ', 'c0', 5),
    ],
    constraints: [],
    visible: true,
  };
}

describe('classifySelection', () => {
  it('groups selected ids by entity kind and ignores unknown ids', () => {
    const result = classifySelection(fixture(), ['p0', 'p1', 'l0', 'circ', 'ghost']);
    expect(result).toEqual({ points: ['p0', 'p1'], lines: ['l0'], circles: ['circ'] });
  });
});

describe('constraintEligibility', () => {
  it('enables coincident only for exactly two points', () => {
    expect(constraintEligibility(fixture(), ['p0', 'p1']).coincident).toBe(true);
    expect(constraintEligibility(fixture(), ['p0']).coincident).toBe(false);
    expect(constraintEligibility(fixture(), ['p0', 'p1', 'p2']).coincident).toBe(false);
    expect(constraintEligibility(fixture(), ['p0', 'l0']).coincident).toBe(false);
  });

  it('enables horizontal and vertical only for a single line', () => {
    const one = constraintEligibility(fixture(), ['l0']);
    expect(one.horizontal).toBe(true);
    expect(one.vertical).toBe(true);
    const two = constraintEligibility(fixture(), ['l0', 'l1']);
    expect(two.horizontal).toBe(false);
    expect(two.vertical).toBe(false);
  });

  it('enables distance for two points or one line', () => {
    expect(constraintEligibility(fixture(), ['p0', 'p1']).distance).toBe(true);
    expect(constraintEligibility(fixture(), ['l0']).distance).toBe(true);
    expect(constraintEligibility(fixture(), ['circ']).distance).toBe(false);
    expect(constraintEligibility(fixture(), ['p0', 'l0']).distance).toBe(false);
  });

  it('enables radius only for a single circle', () => {
    expect(constraintEligibility(fixture(), ['circ']).radius).toBe(true);
    expect(constraintEligibility(fixture(), ['l0']).radius).toBe(false);
  });

  it('enables angle only for exactly two lines', () => {
    expect(constraintEligibility(fixture(), ['l0', 'l1']).angle).toBe(true);
    expect(constraintEligibility(fixture(), ['l0']).angle).toBe(false);
    expect(constraintEligibility(fixture(), ['l0', 'l1', 'l2']).angle).toBe(false);
  });

  it('disables everything for an empty selection', () => {
    expect(constraintEligibility(fixture(), [])).toEqual({
      coincident: false,
      horizontal: false,
      vertical: false,
      distance: false,
      radius: false,
      angle: false,
    });
  });
});

describe('measureSignedAngleDeg', () => {
  it('is +90 from the +x edge to the +y edge', () => {
    expect(measureSignedAngleDeg(fixture(), 'l0', 'l1')).toBeCloseTo(90, 6);
  });
  it('negates when the line order is swapped', () => {
    expect(measureSignedAngleDeg(fixture(), 'l1', 'l0')).toBeCloseTo(-90, 6);
  });
});

describe('buildConstraintForSelection', () => {
  it('builds a coincident constraint between two selected points', () => {
    expect(buildConstraintForSelection(fixture(), ['p0', 'p1'], 'coincident')).toEqual({ kind: 'coincident', pointA: 'p0', pointB: 'p1' });
  });

  it('builds horizontal/vertical constraints for a line', () => {
    expect(buildConstraintForSelection(fixture(), ['l0'], 'horizontal')).toEqual({ kind: 'horizontal', lineId: 'l0' });
    expect(buildConstraintForSelection(fixture(), ['l1'], 'vertical')).toEqual({ kind: 'vertical', lineId: 'l1' });
  });

  it('measures the current length for a distance from two points', () => {
    expect(buildConstraintForSelection(fixture(), ['p0', 'p2'], 'distance')).toEqual({ kind: 'distance', pointA: 'p0', pointB: 'p2', value: 5 });
  });

  it('measures the current length for a distance from a line', () => {
    expect(buildConstraintForSelection(fixture(), ['l1'], 'distance')).toEqual({ kind: 'distance', pointA: 'p1', pointB: 'p2', value: 3 });
  });

  it('measures the current radius for a circle', () => {
    expect(buildConstraintForSelection(fixture(), ['circ'], 'radius')).toEqual({ kind: 'radius', circleId: 'circ', value: 5 });
  });

  it('measures a positive angle, reordering lines so the value stays in (0, 180)', () => {
    expect(buildConstraintForSelection(fixture(), ['l1', 'l0'], 'angle')).toEqual({ kind: 'angle', lineA: 'l0', lineB: 'l1', valueDeg: 90 });
  });

  it('returns null when the selection is ineligible for the kind', () => {
    expect(buildConstraintForSelection(fixture(), ['p0'], 'coincident')).toBeNull();
    expect(buildConstraintForSelection(fixture(), ['l0'], 'radius')).toBeNull();
  });

  it('returns null for a zero-length distance (coincident points)', () => {
    const sketch = fixture();
    sketch.entities.push(point('dup', 4, 0));
    expect(buildConstraintForSelection(sketch, ['p1', 'dup'], 'distance')).toBeNull();
  });

  it('returns null for a degenerate (parallel) angle', () => {
    const sketch = fixture();
    // l0 is p0->p1 (+x); a parallel edge p3->p2 (+x) makes the angle 0.
    sketch.entities.push(line('lpar', 'p3', 'p2'));
    expect(buildConstraintForSelection(sketch, ['l0', 'lpar'], 'angle')).toBeNull();
  });
});
