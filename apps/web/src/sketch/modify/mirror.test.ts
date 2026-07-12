import type { SketchConstraint, SketchEntity, SketchFeature } from '@swalha-cad/document';
import { signedArcSweep } from '@swalha-cad/geometry';
import { describe, expect, it } from 'vitest';
import { applyMirror, computeMirror, pickMirrorAxis } from './mirror.js';

function sketch(entities: SketchEntity[], constraints: SketchConstraint[] = []): SketchFeature {
  return { id: 'sk', kind: 'sketch', name: 'Sketch', plane: 'XY', entities, constraints, visible: true };
}

function point(id: string, x: number, y: number, construction = false): SketchEntity {
  return { id, kind: 'point', x, y, construction };
}
function line(id: string, startId: string, endId: string, construction = false): SketchEntity {
  return { id, kind: 'line', startId, endId, construction };
}

/** Sequential id generator so mirrored ids are deterministic and inspectable. */
function ids() {
  let n = 0;
  return () => `m-${++n}`;
}

function pointsOf(feature: SketchFeature): Extract<SketchEntity, { kind: 'point' }>[] {
  return feature.entities.filter((e): e is Extract<SketchEntity, { kind: 'point' }> => e.kind === 'point');
}
function coord(feature: SketchFeature, id: string): [number, number] {
  const p = pointsOf(feature).find((e) => e.id === id)!;
  return [p.x, p.y];
}

describe('computeMirror — reflection of each entity kind', () => {
  it('mirrors a point across a vertical axis (x flips about the axis)', () => {
    const s = sketch([point('p', 10, 5), point('a0', 0, -10), point('a1', 0, 10), line('axis', 'a0', 'a1')]);
    const result = computeMirror(s, ['p'], 'axis');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.preview.points[0]).toEqual([-10, 5]);
  });

  it('mirrors a line across a horizontal axis (y flips)', () => {
    const s = sketch([
      point('p0', 2, 4),
      point('p1', 8, 6),
      line('l', 'p0', 'p1'),
      point('a0', -10, 0),
      point('a1', 10, 0),
      line('axis', 'a0', 'a1'),
    ]);
    const result = computeMirror(s, ['l'], 'axis');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.preview.lines[0]).toEqual([[2, -4], [8, -6]]);
  });

  it('mirrors a circle across an angled axis, preserving radius', () => {
    const s = sketch([
      point('c', 4, 0),
      { id: 'circ', kind: 'circle', centerId: 'c', radius: 3, construction: false },
      point('a0', 0, 0),
      point('a1', 5, 5),
      line('axis', 'a0', 'a1'),
    ]);
    const result = computeMirror(s, ['circ'], 'axis');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preview.circles[0]!.radius).toBe(3);
      // (4,0) reflected across y=x → (0,4).
      expect(result.preview.circles[0]!.center[0]).toBeCloseTo(0, 9);
      expect(result.preview.circles[0]!.center[1]).toBeCloseTo(4, 9);
    }
  });

  it('mirrors an arc, reversing its direction and preserving sweep magnitude', () => {
    const arc: SketchEntity = {
      id: 'arc',
      kind: 'arc',
      centerId: 'c',
      radius: 2,
      startAngle: 0,
      endAngle: Math.PI / 2,
      direction: 'ccw',
      construction: false,
    };
    const s = sketch([point('c', 0, 0), arc, point('a0', -5, 0), point('a1', 5, 0), line('axis', 'a0', 'a1')]);
    const result = computeMirror(s, ['arc'], 'axis');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const m = result.preview.arcs[0]!;
      expect(m.direction).toBe('cw');
      expect(Math.abs(signedArcSweep(m))).toBeCloseTo(Math.PI / 2, 9);
    }
  });
});

describe('applyMirror — topology, determinism, and non-mutation', () => {
  it('shared source points become one shared mirrored point', () => {
    // Two lines meeting at a shared corner point 'shared'.
    const s = sketch([
      point('shared', 0, 10),
      point('p1', 10, 10),
      point('p2', 0, 20),
      line('l1', 'shared', 'p1'),
      line('l2', 'shared', 'p2'),
      point('a0', -50, 0),
      point('a1', 50, 0),
      line('axis', 'a0', 'a1'),
    ]);
    const result = computeMirror(s, ['l1', 'l2'], 'axis');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const edit = applyMirror(s, result.resolution, ids());
    const mirroredLines = edit.entities
      .filter((e): e is Extract<SketchEntity, { kind: 'line' }> => e.kind === 'line')
      .filter((l) => l.id.startsWith('m-'));
    expect(mirroredLines).toHaveLength(2);
    // Both mirrored lines reference the SAME mirrored point for the shared corner.
    const sharedRefs = new Set(mirroredLines.map((l) => l.startId));
    expect(sharedRefs.size).toBe(1);
  });

  it('produces identical ids regardless of selection order', () => {
    const base: SketchEntity[] = [
      point('p0', 2, 4),
      point('p1', 8, 6),
      point('p2', 12, 9),
      line('lA', 'p0', 'p1'),
      line('lB', 'p1', 'p2'),
      point('a0', -10, 0),
      point('a1', 10, 0),
      line('axis', 'a0', 'a1'),
    ];
    const r1 = computeMirror(sketch(base), ['lA', 'lB'], 'axis');
    const r2 = computeMirror(sketch(base), ['lB', 'lA'], 'axis');
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    const e1 = applyMirror(sketch(base), r1.resolution, ids());
    const e2 = applyMirror(sketch(base), r2.resolution, ids());
    const norm = (e: { entities: SketchEntity[] }) =>
      e.entities.filter((x) => x.id.startsWith('m-')).map((x) => ({ ...x }));
    expect(norm(e1)).toEqual(norm(e2));
  });

  it('does not mutate the source geometry', () => {
    const base = sketch([
      point('p0', 2, 4),
      point('p1', 8, 6),
      line('l', 'p0', 'p1'),
      point('a0', -10, 0),
      point('a1', 10, 0),
      line('axis', 'a0', 'a1'),
    ]);
    const before = JSON.stringify(base.entities.filter((e) => !e.id.startsWith('m-')));
    const result = computeMirror(base, ['l'], 'axis');
    if (!result.ok) throw new Error('expected ok');
    const edit = applyMirror(base, result.resolution, ids());
    // Original entities all still present and unchanged.
    const after = JSON.stringify(edit.entities.filter((e) => ['p0', 'p1', 'l', 'a0', 'a1', 'axis'].includes(e.id)));
    expect(after).toBe(before);
  });
});

describe('applyMirror — constraint cloning and skipping', () => {
  const grid: SketchEntity[] = [
    point('p0', 2, 4),
    point('p1', 8, 4),
    line('l', 'p0', 'p1'),
    point('a0', -20, 0),
    point('a1', 20, 0),
    line('axis', 'a0', 'a1'),
  ];

  it('clones a distance constraint between two mirrored points', () => {
    const d: SketchConstraint = { id: 'd', kind: 'distance', pointA: 'p0', pointB: 'p1', value: 6 };
    const s = sketch(grid, [d]);
    const result = computeMirror(s, ['l'], 'axis');
    if (!result.ok) throw new Error('ok');
    const edit = applyMirror(s, result.resolution, ids());
    const cloned = edit.constraints.filter((c) => c.id.startsWith('m-'));
    expect(cloned).toHaveLength(1);
    expect(cloned[0]).toMatchObject({ kind: 'distance', value: 6 });
    expect(edit.skippedConstraintCount).toBe(0);
  });

  it('clones a horizontal constraint when the axis is horizontal', () => {
    const h: SketchConstraint = { id: 'h', kind: 'horizontal', lineId: 'l' };
    const s = sketch(grid, [h]);
    const result = computeMirror(s, ['l'], 'axis');
    if (!result.ok) throw new Error('ok');
    const edit = applyMirror(s, result.resolution, ids());
    expect(edit.constraints.filter((c) => c.id.startsWith('m-') && c.kind === 'horizontal')).toHaveLength(1);
    expect(edit.skippedConstraintCount).toBe(0);
  });

  it('skips a horizontal constraint when the axis is angled', () => {
    const angledAxis: SketchEntity[] = [
      point('p0', 2, 4),
      point('p1', 8, 4),
      line('l', 'p0', 'p1'),
      point('a0', 0, 0),
      point('a1', 5, 5),
      line('axis', 'a0', 'a1'),
    ];
    const h: SketchConstraint = { id: 'h', kind: 'horizontal', lineId: 'l' };
    const s = sketch(angledAxis, [h]);
    const result = computeMirror(s, ['l'], 'axis');
    if (!result.ok) throw new Error('ok');
    const edit = applyMirror(s, result.resolution, ids());
    expect(edit.constraints.filter((c) => c.id.startsWith('m-'))).toHaveLength(0);
    expect(edit.skippedConstraintCount).toBe(1);
  });

  it('skips (and reports) a constraint referencing geometry outside the selection', () => {
    // Distance from a mirrored point p0 to an unselected external point 'ext'.
    const withExt: SketchEntity[] = [...grid, point('ext', 99, 99)];
    const d: SketchConstraint = { id: 'd', kind: 'distance', pointA: 'p0', pointB: 'ext', value: 5 };
    const s = sketch(withExt, [d]);
    const result = computeMirror(s, ['l'], 'axis');
    if (!result.ok) throw new Error('ok');
    const edit = applyMirror(s, result.resolution, ids());
    expect(edit.constraints.filter((c) => c.id.startsWith('m-'))).toHaveLength(0);
    expect(edit.skippedConstraintCount).toBe(1);
  });

  it('clones a radius constraint onto the mirrored circle', () => {
    const s = sketch(
      [
        point('c', 4, 6),
        { id: 'circ', kind: 'circle', centerId: 'c', radius: 3, construction: false },
        point('a0', -20, 0),
        point('a1', 20, 0),
        line('axis', 'a0', 'a1'),
      ],
      [{ id: 'r', kind: 'radius', circleId: 'circ', value: 3 }],
    );
    const result = computeMirror(s, ['circ'], 'axis');
    if (!result.ok) throw new Error('ok');
    const edit = applyMirror(s, result.resolution, ids());
    expect(edit.constraints.filter((c) => c.id.startsWith('m-') && c.kind === 'radius')).toHaveLength(1);
  });
});

describe('computeMirror — rejections', () => {
  const grid: SketchEntity[] = [
    point('p0', 2, 4),
    point('p1', 8, 6),
    line('l', 'p0', 'p1'),
    point('a0', -10, 0),
    point('a1', 10, 0),
    line('axis', 'a0', 'a1'),
  ];

  it('rejects an empty source set', () => {
    const r = computeMirror(sketch(grid), [], 'axis');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no-sources');
  });

  it('rejects a non-line axis', () => {
    const r = computeMirror(sketch(grid), ['l'], 'p0');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('axis-not-a-line');
  });

  it('rejects a zero-length axis line', () => {
    const s = sketch([point('p', 5, 5), point('z0', 1, 1), point('z1', 1, 1), line('axis', 'z0', 'z1')]);
    const r = computeMirror(s, ['p'], 'axis');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('zero-length-axis');
  });

  it('rejects the axis being included as a source', () => {
    const r = computeMirror(sketch(grid), ['l', 'axis'], 'axis');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('axis-is-source');
  });

  it('rejects a missing source id', () => {
    const r = computeMirror(sketch(grid), ['nope'], 'axis');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing-source');
  });
});

describe('pickMirrorAxis', () => {
  it('picks the nearest line within range and ignores non-lines', () => {
    const s = sketch([
      point('a0', 0, 0),
      point('a1', 10, 0),
      line('axis', 'a0', 'a1'),
      point('lone', 0, 50),
    ]);
    expect(pickMirrorAxis(s, [5, 0.5])).toBe('axis');
    expect(pickMirrorAxis(s, [5, 40])).toBeNull();
  });
});

describe('coord helper stays consistent', () => {
  it('reflected coords match a manual reflection', () => {
    const s = sketch([point('p', 3, 7), point('a0', 0, 0), point('a1', 0, 1), line('axis', 'a0', 'a1')]);
    const r = computeMirror(s, ['p'], 'axis');
    if (!r.ok) throw new Error('ok');
    const edit = applyMirror(s, r.resolution, ids());
    expect(coord({ ...s, entities: edit.entities }, edit.createdEntityIds[0]!)).toEqual([-3, 7]);
  });
});
