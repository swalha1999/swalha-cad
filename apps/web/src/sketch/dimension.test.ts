import { describe, expect, it } from 'vitest';
import type { SketchFeature } from '@swalha-cad/document';
import {
  dimensionAnnotation,
  lineEndpoints,
  measureDistance,
  pickForDimension,
  resolveFromSelection,
} from './dimension.js';

/** A sketch with two points p0(0,0), p1(30,40) joined by line l, plus a free point p2(10,0). */
function fixture(): SketchFeature {
  return {
    id: 's',
    kind: 'sketch',
    name: 'Sketch 1',
    plane: 'XY',
    entities: [
      { id: 'p0', kind: 'point', x: 0, y: 0, construction: false },
      { id: 'p1', kind: 'point', x: 30, y: 40, construction: false },
      { id: 'p2', kind: 'point', x: 10, y: 0, construction: false },
      { id: 'l', kind: 'line', startId: 'p0', endId: 'p1', construction: false },
    ],
    constraints: [],
    visible: true,
  };
}

describe('measureDistance', () => {
  it('returns the Euclidean distance between two points', () => {
    expect(measureDistance(fixture(), 'p0', 'p1')).toBeCloseTo(50, 9);
  });

  it('returns null for a missing point', () => {
    expect(measureDistance(fixture(), 'p0', 'nope')).toBeNull();
  });
});

describe('lineEndpoints', () => {
  it('returns the ordered endpoint ids of a line', () => {
    expect(lineEndpoints(fixture(), 'l')).toEqual(['p0', 'p1']);
  });

  it('returns null for a non-line id', () => {
    expect(lineEndpoints(fixture(), 'p0')).toBeNull();
  });
});

describe('resolveFromSelection', () => {
  it('resolves a single selected line to its endpoints and measured length', () => {
    expect(resolveFromSelection(fixture(), ['l'])).toEqual({ pointA: 'p0', pointB: 'p1', measured: 50 });
  });

  it('resolves two selected points to that pair and their distance', () => {
    expect(resolveFromSelection(fixture(), ['p0', 'p2'])).toEqual({ pointA: 'p0', pointB: 'p2', measured: 10 });
  });

  it('returns null for a selection that is not one line or two points', () => {
    expect(resolveFromSelection(fixture(), [])).toBeNull();
    expect(resolveFromSelection(fixture(), ['p0'])).toBeNull();
    expect(resolveFromSelection(fixture(), ['p0', 'l'])).toBeNull();
  });
});

describe('pickForDimension', () => {
  it('resolves immediately when a line is clicked', () => {
    expect(pickForDimension(fixture(), [], 'l')).toEqual({
      kind: 'awaiting',
      dimension: { pointA: 'p0', pointB: 'p1', measured: 50 },
    });
  });

  it('accumulates the first clicked point', () => {
    expect(pickForDimension(fixture(), [], 'p0')).toEqual({ kind: 'picking', points: ['p0'] });
  });

  it('resolves to a dimension once a second distinct point is clicked', () => {
    expect(pickForDimension(fixture(), ['p0'], 'p2')).toEqual({
      kind: 'awaiting',
      dimension: { pointA: 'p0', pointB: 'p2', measured: 10 },
    });
  });

  it('ignores clicking the same point twice', () => {
    expect(pickForDimension(fixture(), ['p0'], 'p0')).toEqual({ kind: 'picking', points: ['p0'] });
  });

  it('ignores ids that are not in the sketch', () => {
    expect(pickForDimension(fixture(), [], 'ghost')).toBeNull();
  });
});

describe('dimensionAnnotation', () => {
  it('offsets the dimension line perpendicular to the measured segment', () => {
    const annotation = dimensionAnnotation(fixture(), { pointA: 'p0', pointB: 'p2' }, 8);
    expect(annotation).not.toBeNull();
    // p0->p2 runs along +x, so the perpendicular offset is along the y axis.
    expect(annotation!.aOff.x).toBeCloseTo(0, 9);
    expect(Math.abs(annotation!.aOff.y)).toBeCloseTo(8, 9);
    expect(annotation!.mid.x).toBeCloseTo(5, 9);
  });

  it('returns null when a point is missing', () => {
    expect(dimensionAnnotation(fixture(), { pointA: 'p0', pointB: 'nope' }, 8)).toBeNull();
  });
});
