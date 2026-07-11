import type { SketchFeature } from '@swalha-cad/document';
import { describe, expect, it } from 'vitest';
import { removeSketchEntities } from './delete.js';

/** A unit square (p1..p4) with four lines, plus a circle on its own center point. */
function squareWithCircle(): SketchFeature {
  return {
    id: 'sketch-1',
    kind: 'sketch',
    name: 'Sketch 1',
    plane: 'XY',
    visible: true,
    entities: [
      { id: 'p1', kind: 'point', x: 0, y: 0, construction: false },
      { id: 'p2', kind: 'point', x: 10, y: 0, construction: false },
      { id: 'p3', kind: 'point', x: 10, y: 10, construction: false },
      { id: 'p4', kind: 'point', x: 0, y: 10, construction: false },
      { id: 'l1', kind: 'line', startId: 'p1', endId: 'p2', construction: false },
      { id: 'l2', kind: 'line', startId: 'p2', endId: 'p3', construction: false },
      { id: 'l3', kind: 'line', startId: 'p3', endId: 'p4', construction: false },
      { id: 'l4', kind: 'line', startId: 'p4', endId: 'p1', construction: false },
      { id: 'cp', kind: 'point', x: 20, y: 20, construction: false },
      { id: 'c1', kind: 'circle', centerId: 'cp', radius: 5, construction: false },
    ],
    constraints: [
      { id: 'h1', kind: 'horizontal', lineId: 'l1' },
      { id: 'v1', kind: 'vertical', lineId: 'l2' },
      { id: 'r1', kind: 'radius', circleId: 'c1', value: 5 },
      { id: 'co1', kind: 'coincident', pointA: 'p1', pointB: 'p4' },
    ],
  };
}

describe('removeSketchEntities', () => {
  it('removes a selected line and any constraint that references it', () => {
    const { entities, constraints } = removeSketchEntities(squareWithCircle(), ['l1']);

    expect(entities.some((entity) => entity.id === 'l1')).toBe(false);
    // Its endpoints survive (they may be shared with other geometry).
    expect(entities.some((entity) => entity.id === 'p1')).toBe(true);
    expect(entities.some((entity) => entity.id === 'p2')).toBe(true);
    // The horizontal constraint on l1 is cleaned up; unrelated constraints remain.
    expect(constraints.map((c) => c.id).sort()).toEqual(['co1', 'r1', 'v1']);
  });

  it('cascades to lines that reference a deleted point and cleans their constraints', () => {
    const { entities, constraints } = removeSketchEntities(squareWithCircle(), ['p1']);

    // p1 is used by l1 and l4, so both lines go with it.
    expect(entities.some((entity) => entity.id === 'p1')).toBe(false);
    expect(entities.some((entity) => entity.id === 'l1')).toBe(false);
    expect(entities.some((entity) => entity.id === 'l4')).toBe(false);
    // l2/l3 are untouched.
    expect(entities.some((entity) => entity.id === 'l2')).toBe(true);
    // The horizontal constraint (on l1) and the coincident constraint (on p1) are removed.
    expect(constraints.map((c) => c.id).sort()).toEqual(['r1', 'v1']);
  });

  it('cascades to a circle when its center point is deleted', () => {
    const { entities, constraints } = removeSketchEntities(squareWithCircle(), ['cp']);

    expect(entities.some((entity) => entity.id === 'cp')).toBe(false);
    expect(entities.some((entity) => entity.id === 'c1')).toBe(false);
    expect(constraints.some((c) => c.id === 'r1')).toBe(false);
  });

  it('removes a circle directly without touching its center point', () => {
    const { entities } = removeSketchEntities(squareWithCircle(), ['c1']);

    expect(entities.some((entity) => entity.id === 'c1')).toBe(false);
    expect(entities.some((entity) => entity.id === 'cp')).toBe(true);
  });

  it('is a no-op for ids that are not in the sketch', () => {
    const original = squareWithCircle();
    const { entities, constraints } = removeSketchEntities(original, ['ghost']);

    expect(entities).toHaveLength(original.entities.length);
    expect(constraints).toHaveLength(original.constraints.length);
  });

  it('does not mutate the input sketch', () => {
    const original = squareWithCircle();
    removeSketchEntities(original, ['p1']);

    expect(original.entities).toHaveLength(10);
    expect(original.constraints).toHaveLength(4);
  });
});
