import type { SketchEntity } from '@swalha-cad/document';
import { describe, expect, it } from 'vitest';
import { analyzeLineLoopTopology, indexSketchEntities } from './topology.js';

function point(id: string, x: number, y: number, construction = false): SketchEntity {
  return { id, kind: 'point', x, y, construction };
}

function line(id: string, startId: string, endId: string, construction = false): SketchEntity {
  return { id, kind: 'line', startId, endId, construction };
}

function circle(id: string, centerId: string, radius: number, construction = false): SketchEntity {
  return { id, kind: 'circle', centerId, radius, construction };
}

/** p0-p1-p2-p3-p0, a unit rectangle. */
function rectanglePoints(): SketchEntity[] {
  return [point('p0', 0, 0), point('p1', 4, 0), point('p2', 4, 2), point('p3', 0, 2)];
}

function rectangleLines(): SketchEntity[] {
  return [line('l0', 'p0', 'p1'), line('l1', 'p1', 'p2'), line('l2', 'p2', 'p3'), line('l3', 'p3', 'p0')];
}

describe('indexSketchEntities: point/line lookup', () => {
  it('looks up a point by id', () => {
    const index = indexSketchEntities([point('p0', 1, 2)]);
    expect(index.points.get('p0')).toEqual(point('p0', 1, 2));
  });

  it('looks up a line by id', () => {
    const l = line('l0', 'p0', 'p1');
    const index = indexSketchEntities([l]);
    expect(index.lines.get('l0')).toEqual(l);
  });

  it('looks up a circle by id', () => {
    const c = circle('c0', 'p0', 5);
    const index = indexSketchEntities([c]);
    expect(index.circles.get('c0')).toEqual(c);
  });

  it('returns undefined for an id that is not present', () => {
    const index = indexSketchEntities([point('p0', 0, 0)]);
    expect(index.points.get('missing')).toBeUndefined();
    expect(index.lines.get('missing')).toBeUndefined();
  });
});

describe('analyzeLineLoopTopology: valid rectangle', () => {
  it('resolves a rectangle given in natural order into a closed loop', () => {
    const result = analyzeLineLoopTopology([...rectanglePoints(), ...rectangleLines()]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(new Set(result.loop.pointIds)).toEqual(new Set(['p0', 'p1', 'p2', 'p3']));
    expect(new Set(result.loop.lineIds)).toEqual(new Set(['l0', 'l1', 'l2', 'l3']));
    expect(result.loop.pointIds.length).toBe(4);
    expect(result.loop.lineIds.length).toBe(4);
  });

  it('resolves the same rectangle when its lines are shuffled', () => {
    const shuffled = [
      ...rectanglePoints(),
      line('l2', 'p2', 'p3'),
      line('l0', 'p0', 'p1'),
      line('l3', 'p3', 'p0'),
      line('l1', 'p1', 'p2'),
    ];
    const result = analyzeLineLoopTopology(shuffled);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(new Set(result.loop.pointIds)).toEqual(new Set(['p0', 'p1', 'p2', 'p3']));
  });

  it('resolves the same rectangle when some edges are given in reversed start/end order', () => {
    const reversed = [
      ...rectanglePoints(),
      line('l0', 'p1', 'p0'),
      line('l1', 'p1', 'p2'),
      line('l2', 'p3', 'p2'),
      line('l3', 'p3', 'p0'),
    ];
    const result = analyzeLineLoopTopology(reversed);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(new Set(result.loop.pointIds)).toEqual(new Set(['p0', 'p1', 'p2', 'p3']));
  });

  it('produces an identical loop for shuffled and reversed variants of the same rectangle (order-independence)', () => {
    const natural = analyzeLineLoopTopology([...rectanglePoints(), ...rectangleLines()]);
    const shuffled = analyzeLineLoopTopology([
      ...rectanglePoints(),
      line('l3', 'p3', 'p0'),
      line('l1', 'p2', 'p1'),
      line('l0', 'p0', 'p1'),
      line('l2', 'p2', 'p3'),
    ]);
    expect(natural).toEqual(shuffled);
  });

  it('adjacent segment order in the loop connects consecutive points via the stated line', () => {
    const result = analyzeLineLoopTopology([...rectanglePoints(), ...rectangleLines()]);
    if (!result.ok) throw new Error('expected ok');
    const { pointIds, lineIds } = result.loop;
    const index = indexSketchEntities([...rectanglePoints(), ...rectangleLines()]);
    for (let i = 0; i < lineIds.length; i++) {
      const lineEntity = index.lines.get(lineIds[i]!)!;
      const a = pointIds[i]!;
      const b = pointIds[(i + 1) % pointIds.length]!;
      const endpoints = new Set([lineEntity.kind === 'line' ? lineEntity.startId : '', lineEntity.kind === 'line' ? lineEntity.endId : '']);
      expect(endpoints).toEqual(new Set([a, b]));
    }
  });
});

describe('analyzeLineLoopTopology: open chain', () => {
  it('reports an open-chain issue for a chain missing its closing edge', () => {
    const result = analyzeLineLoopTopology([...rectanglePoints(), line('l0', 'p0', 'p1'), line('l1', 'p1', 'p2'), line('l2', 'p2', 'p3')]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['open-chain']);
    expect(new Set(result.issues[0]!.entityIds)).toEqual(new Set(['p0', 'p3']));
  });
});

describe('analyzeLineLoopTopology: branched chain', () => {
  it('reports a branch issue when a point has three incident edges', () => {
    const branchPoints = [...rectanglePoints(), point('p4', 2, 5)];
    const branchLines = [...rectangleLines(), line('l4', 'p1', 'p4')];
    const result = analyzeLineLoopTopology([...branchPoints, ...branchLines]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['branch']);
    expect(result.issues[0]!.entityIds).toContain('p1');
  });
});

describe('analyzeLineLoopTopology: disconnected chains', () => {
  it('reports a disconnected issue for two separate closed loops', () => {
    const secondLoop = [
      point('q0', 10, 10),
      point('q1', 14, 10),
      point('q2', 14, 12),
      point('q3', 10, 12),
      line('m0', 'q0', 'q1'),
      line('m1', 'q1', 'q2'),
      line('m2', 'q2', 'q3'),
      line('m3', 'q3', 'q0'),
    ];
    const result = analyzeLineLoopTopology([...rectanglePoints(), ...rectangleLines(), ...secondLoop]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['disconnected']);
    expect(result.issues[0]!.entityIds.length).toBe(8);
  });
});

describe('analyzeLineLoopTopology: duplicate edges', () => {
  it('reports a duplicate-edge issue for the same directed edge twice', () => {
    const result = analyzeLineLoopTopology([...rectanglePoints(), ...rectangleLines(), line('l0dup', 'p0', 'p1')]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['duplicate-edge']);
    expect(new Set(result.issues[0]!.entityIds)).toEqual(new Set(['l0', 'l0dup']));
  });

  it('reports a duplicate-edge issue for the same edge given in reversed direction', () => {
    const result = analyzeLineLoopTopology([...rectanglePoints(), ...rectangleLines(), line('l0rev', 'p1', 'p0')]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['duplicate-edge']);
    expect(new Set(result.issues[0]!.entityIds)).toEqual(new Set(['l0', 'l0rev']));
  });
});

describe('analyzeLineLoopTopology: zero-length edges', () => {
  it('reports a zero-length-edge issue when a line references the same point twice', () => {
    const result = analyzeLineLoopTopology([...rectanglePoints(), line('degenerate', 'p0', 'p0')]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['zero-length-edge']);
  });

  it('reports a zero-length-edge issue when a line spans two coincident but distinct points', () => {
    const result = analyzeLineLoopTopology([point('a', 1, 1), point('b', 1, 1), line('degenerate', 'a', 'b')]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['zero-length-edge']);
  });
});

describe('analyzeLineLoopTopology: missing references', () => {
  it('reports a missing-reference issue when a line points at a nonexistent point', () => {
    const result = analyzeLineLoopTopology([point('p0', 0, 0), line('l0', 'p0', 'ghost')]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['missing-reference']);
    expect(result.issues[0]!.entityIds).toContain('ghost');
  });
});

describe('analyzeLineLoopTopology: construction exclusion', () => {
  it('ignores construction lines entirely, treating a valid non-construction rectangle as closed', () => {
    const result = analyzeLineLoopTopology([...rectanglePoints(), ...rectangleLines(), line('diag', 'p0', 'p2', true)]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.loop.lineIds).not.toContain('diag');
  });

  it('does not let a construction line stand in for a missing real edge', () => {
    const result = analyzeLineLoopTopology([...rectanglePoints(), line('l0', 'p0', 'p1'), line('l1', 'p1', 'p2'), line('l2', 'p2', 'p3', true), line('l3', 'p3', 'p0')]);
    expect(result.ok).toBe(false);
  });
});

describe('analyzeLineLoopTopology: deterministic repeated output', () => {
  it('returns a deep-equal result across repeated calls with the same input', () => {
    const entities = [...rectanglePoints(), ...rectangleLines()];
    const first = analyzeLineLoopTopology(entities);
    const second = analyzeLineLoopTopology(entities);
    expect(first).toEqual(second);
  });
});
