import type { SketchEntity } from '@swalha-cad/document';
import { describe, expect, it } from 'vitest';
import { straightSlot } from './arc.js';
import { analyzeCurveLoopTopology } from './loop.js';
import { pointsClose } from './curves.js';
import type { Vec2 } from './plane.js';

function point(id: string, x: number, y: number, construction = false): SketchEntity {
  return { id, kind: 'point', x, y, construction };
}
function line(id: string, startId: string, endId: string, construction = false): SketchEntity {
  return { id, kind: 'line', startId, endId, construction };
}
function arc(
  id: string,
  centerId: string,
  radius: number,
  startAngle: number,
  endAngle: number,
  direction: 'ccw' | 'cw' = 'ccw',
  construction = false,
): SketchEntity {
  return { id, kind: 'arc', centerId, radius, startAngle, endAngle, direction, construction };
}

/**
 * A "D-shape": a diameter line from (5,0) to (-5,0) closed by an upper
 * semicircular arc of radius 5 about the origin. The arc's endpoints are
 * derived, and coincide with the line's point coordinates only within tolerance.
 */
function dShape(): SketchEntity[] {
  return [
    point('a', 5, 0),
    point('b', -5, 0),
    point('c', 0, 0), // arc center
    line('l', 'a', 'b'),
    arc('arc', 'c', 5, 0, Math.PI, 'ccw'),
  ];
}

/** A full circle drawn as two semicircular arcs sharing endpoints (5,0) and (-5,0). */
function twoArcCircle(): SketchEntity[] {
  return [
    point('c', 0, 0),
    arc('upper', 'c', 5, 0, Math.PI, 'ccw'),
    arc('lower', 'c', 5, Math.PI, 2 * Math.PI, 'ccw'),
  ];
}

/** Slot cap centers at (0,0) and (20,0), width radius 3, as the slot tool would author it. */
function slotEntities(): SketchEntity[] {
  const slot = straightSlot([0, 0], [20, 0], 3)!;
  const { aLeft, aRight, bLeft, bRight } = slot.tangentPoints;
  const [capA, capB] = slot.arcs;
  return [
    point('aL', aLeft[0], aLeft[1]),
    point('bL', bLeft[0], bLeft[1]),
    point('aR', aRight[0], aRight[1]),
    point('bR', bRight[0], bRight[1]),
    point('cA', 0, 0),
    point('cB', 20, 0),
    line('l0', 'aL', 'bL'),
    line('l1', 'aR', 'bR'),
    arc('capA', 'cA', capA!.radius, capA!.startAngle, capA!.endAngle, capA!.direction),
    arc('capB', 'cB', capB!.radius, capB!.startAngle, capB!.endAngle, capB!.direction),
  ];
}

function edgeIds(entities: SketchEntity[]): string[] {
  const result = analyzeCurveLoopTopology(entities);
  if (!result.ok) throw new Error(`expected ok, got ${result.issues.map((i) => i.kind).join(',')}`);
  return result.loop.edges.map((e) => e.id);
}

describe('analyzeCurveLoopTopology — valid mixed loops', () => {
  it('resolves a line + semicircle D-shape into a closed two-edge loop', () => {
    const result = analyzeCurveLoopTopology(dShape());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.loop.edges).toHaveLength(2);
    expect(new Set(result.loop.edges.map((e) => e.id))).toEqual(new Set(['l', 'arc']));
    // Consecutive edges join end-to-start within tolerance.
    const edges = result.loop.edges;
    for (let i = 0; i < edges.length; i++) {
      expect(pointsClose(edges[i]!.end, edges[(i + 1) % edges.length]!.start)).toBe(true);
    }
  });

  it('resolves a full circle authored as two semicircular arcs', () => {
    const result = analyzeCurveLoopTopology(twoArcCircle());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.loop.edges).toHaveLength(2);
  });

  it('resolves a slot (two lines + two cap arcs) into a closed four-edge loop', () => {
    const result = analyzeCurveLoopTopology(slotEntities());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.loop.edges).toHaveLength(4);
    const kinds = result.loop.edges.map((e) => e.kind).sort();
    expect(kinds).toEqual(['arc', 'arc', 'line', 'line']);
  });
});

describe('analyzeCurveLoopTopology — deterministic, order-independent output', () => {
  it('produces an identical canonical loop for shuffled entity order', () => {
    const natural = analyzeCurveLoopTopology(slotEntities());
    const shuffled = analyzeCurveLoopTopology([...slotEntities()].reverse());
    expect(natural).toEqual(shuffled);
  });

  it('produces the same edge sequence regardless of authored winding for the two-arc circle', () => {
    const forward = edgeIds(twoArcCircle());
    // Author the same circle with the lower arc listed first and drawn clockwise.
    const alt: SketchEntity[] = [
      point('c', 0, 0),
      arc('lower', 'c', 5, 2 * Math.PI, Math.PI, 'cw'),
      arc('upper', 'c', 5, Math.PI, 0, 'cw'),
    ];
    const altIds = edgeIds(alt);
    expect(new Set(altIds)).toEqual(new Set(forward));
  });

  it('returns a deep-equal result across repeated calls', () => {
    const a = analyzeCurveLoopTopology(dShape());
    const b = analyzeCurveLoopTopology(dShape());
    expect(a).toEqual(b);
  });
});

describe('analyzeCurveLoopTopology — winding normalization', () => {
  function signedArea(loopEdges: readonly { start: Vec2 }[]): number {
    let sum = 0;
    for (let i = 0; i < loopEdges.length; i++) {
      const a = loopEdges[i]!.start;
      const b = loopEdges[(i + 1) % loopEdges.length]!.start;
      sum += a[0] * b[1] - b[0] * a[1];
    }
    return sum;
  }

  it('winds the slot loop counter-clockwise (positive polygon area on its join vertices)', () => {
    const result = analyzeCurveLoopTopology(slotEntities());
    if (!result.ok) throw new Error('expected ok');
    expect(signedArea(result.loop.edges)).toBeGreaterThan(0);
  });
});

describe('analyzeCurveLoopTopology — structured diagnostics', () => {
  it('flags an open chain when an arc is left dangling', () => {
    const result = analyzeCurveLoopTopology([point('c', 0, 0), arc('a', 'c', 5, 0, Math.PI, 'ccw')]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['open-chain']);
  });

  it('flags a full circle authored as a single arc as ambiguous', () => {
    const result = analyzeCurveLoopTopology([point('c', 0, 0), arc('a', 'c', 5, 0, 2 * Math.PI, 'ccw')]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['full-circle-arc']);
  });

  it('flags a degenerate zero-radius arc', () => {
    const result = analyzeCurveLoopTopology([point('c', 0, 0), arc('a', 'c', 0, 0, Math.PI, 'ccw')]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['zero-sweep-arc']);
  });

  it('flags a branch when a third edge meets a slot corner', () => {
    const entities = [...slotEntities(), point('extra', 100, 100), line('spur', 'aL', 'extra')];
    const result = analyzeCurveLoopTopology(entities);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['branch']);
  });

  it('flags a duplicate (reversed) arc drawn on top of an existing one', () => {
    const dup: SketchEntity[] = [...dShape(), arc('arcDup', 'c', 5, Math.PI, 0, 'cw')];
    const result = analyzeCurveLoopTopology(dup);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['duplicate-edge']);
  });

  it('flags two disconnected loops', () => {
    const second = [
      point('c2', 100, 0),
      arc('u2', 'c2', 5, 0, Math.PI, 'ccw'),
      arc('d2', 'c2', 5, Math.PI, 2 * Math.PI, 'ccw'),
    ];
    const result = analyzeCurveLoopTopology([...twoArcCircle(), ...second]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.issues.map((i) => i.kind)).toEqual(['disconnected']);
  });

  it('excludes construction arcs from the loop', () => {
    const withConstruction: SketchEntity[] = [...dShape(), point('cc', 0, 0, true), arc('ca', 'cc', 8, 0, Math.PI, 'ccw', true)];
    const result = analyzeCurveLoopTopology(withConstruction);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.loop.edges.map((e) => e.id)).not.toContain('ca');
  });
});
