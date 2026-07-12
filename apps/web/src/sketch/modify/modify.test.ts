import type { SketchConstraint, SketchEntity, SketchFeature } from '@swalha-cad/document';
import { detectSketchProfile } from '@swalha-cad/geometry';
import { describe, expect, it } from 'vitest';
import { pickCurve, projectToCurve, resolveCurve, targetSplitParams, type Point } from './curves.js';
import { applyModify, modifyPreview } from './index.js';

/** A deterministic id generator so trim/split output is assertable. */
function idGen(prefix = 'new'): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

function point(id: string, x: number, y: number, construction = false): SketchEntity {
  return { id, kind: 'point', x, y, construction };
}
function line(id: string, startId: string, endId: string, construction = false): SketchEntity {
  return { id, kind: 'line', startId, endId, construction };
}

function sketch(entities: SketchEntity[], constraints: SketchConstraint[] = []): SketchFeature {
  return { id: 'sk', kind: 'sketch', name: 'Sketch 1', plane: 'XY', entities, constraints, visible: true };
}

function lines(feature: SketchFeature): Extract<SketchEntity, { kind: 'line' }>[] {
  return feature.entities.filter((e): e is Extract<SketchEntity, { kind: 'line' }> => e.kind === 'line');
}
function points(feature: SketchFeature): Extract<SketchEntity, { kind: 'point' }>[] {
  return feature.entities.filter((e): e is Extract<SketchEntity, { kind: 'point' }> => e.kind === 'point');
}
function arcsOf(feature: SketchFeature): Extract<SketchEntity, { kind: 'arc' }>[] {
  return feature.entities.filter((e): e is Extract<SketchEntity, { kind: 'arc' }> => e.kind === 'arc');
}

/** Applies a modify outcome's edit onto a sketch, returning the resulting feature. */
function withEdit(base: SketchFeature, edit: { entities: SketchEntity[]; constraints: SketchConstraint[] }): SketchFeature {
  return { ...base, entities: edit.entities, constraints: edit.constraints };
}

describe('curve resolution and picking', () => {
  const s = sketch([
    point('p0', 0, 0),
    point('p1', 100, 0),
    line('l0', 'p0', 'p1'),
    point('c', 40, 20),
    // A circle whose center sits at (40,20), radius 10 — a boundary, never a target here.
    { id: 'circ', kind: 'circle', centerId: 'c', radius: 10, construction: false },
  ]);

  it('resolves a line into its endpoints', () => {
    const curve = resolveCurve(s, 'l0');
    expect(curve?.kind).toBe('line');
    if (curve?.kind === 'line') expect([curve.a, curve.b]).toEqual([[0, 0], [100, 0]]);
  });

  it('picks the nearest line to the cursor and ignores far ones', () => {
    expect(pickCurve(s, [50, 1], 5)?.id).toBe('l0');
    expect(pickCurve(s, [50, 40], 5)).toBeNull();
  });

  it('projects a point onto the nearest position on a line', () => {
    const curve = resolveCurve(s, 'l0')!;
    const projection = projectToCurve(curve, [30, 8]);
    expect(projection.t).toBeCloseTo(0.3, 9);
    expect(projection.distance).toBeCloseTo(8, 9);
  });
});

describe('targetSplitParams: intersection detection', () => {
  it('finds a line-line crossing param and excludes shared endpoints', () => {
    // Horizontal target crossed by a vertical line at x=40; and a second vertical line
    // that only touches the target at its own endpoint (x=100), which must be excluded.
    const s = sketch([
      point('a', 0, 0),
      point('b', 100, 0),
      line('t', 'a', 'b'),
      point('c', 40, -10),
      point('d', 40, 10),
      line('cross', 'c', 'd'),
      point('e', 100, 0),
      point('f', 100, 20),
      line('touch', 'e', 'f'),
    ]);
    const target = resolveCurve(s, 't')!;
    const params = targetSplitParams(s, target);
    expect(params).toHaveLength(1);
    expect(params[0]).toBeCloseTo(0.4, 9);
  });

  it('finds a line-arc crossing param', () => {
    // Semicircle radius 20 about (50,0), upper sweep; horizontal target at y=10 cuts it twice.
    const s = sketch([
      point('a', 0, 10),
      point('b', 100, 10),
      line('t', 'a', 'b'),
      point('cc', 50, 0),
      { id: 'arc', kind: 'arc', centerId: 'cc', radius: 20, startAngle: 0, endAngle: Math.PI, direction: 'ccw', construction: false },
    ]);
    const target = resolveCurve(s, 't')!;
    const params = targetSplitParams(s, target);
    expect(params.length).toBe(2);
  });

  it('uses construction curves as trimming boundaries', () => {
    const s = sketch([
      point('a', 0, 0),
      point('b', 100, 0),
      line('t', 'a', 'b'),
      point('c', 40, -10, true),
      point('d', 40, 10, true),
      line('cross', 'c', 'd', true), // construction boundary
    ]);
    const target = resolveCurve(s, 't')!;
    expect(targetSplitParams(s, target)).toHaveLength(1);
  });
});

describe('trim: line target', () => {
  it('shortens a line to an intersection when the overhang piece is clicked', () => {
    const s = sketch([
      point('a', 0, 0),
      point('b', 120, 0),
      line('t', 'a', 'b'),
      point('c', 100, -10),
      point('d', 100, 10),
      line('cross', 'c', 'd'),
    ]);
    const outcome = applyModify(s, 'trim', [110, 0], idGen());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const result = withEdit(s, outcome.edit);
    const ls = lines(result);
    // 'cross' plus the surviving piece of 't' (which keeps id 't').
    expect(ls.map((l) => l.id).sort()).toEqual(['cross', 't']);
    const t = ls.find((l) => l.id === 't')!;
    // The surviving piece runs from the original start to the intersection (a new point at x≈100).
    expect(t.startId).toBe('a');
    const end = points(result).find((p) => p.id === t.endId)!;
    expect(end.x).toBeCloseTo(100, 6);
    // The far original endpoint (b at x=120) is now orphaned and removed.
    expect(points(result).some((p) => p.id === 'b')).toBe(false);
  });

  it('removes the middle piece leaving two lines when an interior piece is clicked', () => {
    const s = sketch([
      point('a', 0, 0),
      point('b', 120, 0),
      line('t', 'a', 'b'),
      point('c1', 40, -10),
      point('d1', 40, 10),
      line('x1', 'c1', 'd1'),
      point('c2', 80, -10),
      point('d2', 80, 10),
      line('x2', 'c2', 'd2'),
    ]);
    const outcome = applyModify(s, 'trim', [60, 0], idGen());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const result = withEdit(s, outcome.edit);
    const stubs = lines(result).filter((l) => l.id === 't' || !['x1', 'x2'].includes(l.id));
    // Two surviving pieces of the target: [a..40] and [80..b].
    expect(stubs).toHaveLength(2);
    expect(points(result).some((p) => p.id === 'a')).toBe(true);
    expect(points(result).some((p) => p.id === 'b')).toBe(true);
  });

  it('reports a no-op with a diagnostic when there are no interior intersections', () => {
    const s = sketch([point('a', 0, 0), point('b', 100, 0), line('t', 'a', 'b')]);
    const outcome = applyModify(s, 'trim', [50, 0], idGen());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toMatch(/no intersections/i);
  });

  it('preserves the construction flag on trimmed pieces', () => {
    const s = sketch([
      point('a', 0, 0, true),
      point('b', 120, 0, true),
      line('t', 'a', 'b', true),
      point('c', 60, -10),
      point('d', 60, 10),
      line('cross', 'c', 'd'),
    ]);
    const outcome = applyModify(s, 'trim', [100, 0], idGen());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const result = withEdit(s, outcome.edit);
    expect(lines(result).find((l) => l.id === 't')!.construction).toBe(true);
  });

  it('fuses a boundary that lands on an existing point, closing a rectangle profile', () => {
    // A closed square P0..P3 with the left edge overhanging below the bottom edge.
    const s = sketch([
      point('p0', 0, 0),
      point('p1', 100, 0),
      point('p2', 100, 80),
      point('p3', 0, 80),
      point('p4', 0, -30), // overhang tip
      line('bottom', 'p0', 'p1'),
      line('right', 'p1', 'p2'),
      line('top', 'p2', 'p3'),
      line('left', 'p3', 'p4'), // crosses the bottom line at p0=(0,0)
    ]);
    const outcome = applyModify(s, 'trim', [0, -15], idGen());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const result = withEdit(s, outcome.edit);
    // The overhang tip p4 is gone; the left edge now ends on the existing corner p0.
    expect(points(result).some((p) => p.id === 'p4')).toBe(false);
    const left = lines(result).find((l) => l.id === 'left')!;
    expect(left.endId).toBe('p0');
    // The four lines now form one closed, valid profile.
    const profile = detectSketchProfile(result);
    expect(profile.ok).toBe(true);
  });
});

describe('trim: constraint cleanup and remap', () => {
  it('keeps a horizontal constraint on the retained id and copies it onto a second piece', () => {
    const s = sketch(
      [
        point('a', 0, 0),
        point('b', 120, 0),
        line('t', 'a', 'b'),
        point('c1', 40, -10),
        point('d1', 40, 10),
        line('x1', 'c1', 'd1'),
        point('c2', 80, -10),
        point('d2', 80, 10),
        line('x2', 'c2', 'd2'),
      ],
      [{ id: 'h', kind: 'horizontal', lineId: 't' }],
    );
    const outcome = applyModify(s, 'trim', [60, 0], idGen());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const horizontals = outcome.edit.constraints.filter((c) => c.kind === 'horizontal');
    // One on the retained 't' plus one copied onto the new second piece.
    expect(horizontals).toHaveLength(2);
    const ids = new Set(lines(withEdit(s, outcome.edit)).map((l) => l.id));
    for (const c of horizontals) if (c.kind === 'horizontal') expect(ids.has(c.lineId)).toBe(true);
  });

  it('drops a coincident constraint on an endpoint that the trim removes', () => {
    const s = sketch(
      [
        point('a', 0, 0),
        point('b', 120, 0),
        line('t', 'a', 'b'),
        point('c', 100, -10),
        point('d', 100, 10),
        line('cross', 'c', 'd'),
        point('anchor', 200, 0),
      ],
      [{ id: 'co', kind: 'coincident', pointA: 'b', pointB: 'anchor' }],
    );
    const outcome = applyModify(s, 'trim', [110, 0], idGen());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // 'b' was orphaned and removed, so the coincident constraint referencing it is gone.
    expect(outcome.edit.constraints.some((c) => c.id === 'co')).toBe(false);
  });
});

describe('trim: arc target', () => {
  it('splits an arc into surviving sub-arcs around the removed piece', () => {
    // Full-ish arc (0..π) about origin r=50 crossed by two vertical lines.
    const s = sketch([
      point('o', 0, 0),
      { id: 'arc', kind: 'arc', centerId: 'o', radius: 50, startAngle: 0, endAngle: Math.PI, direction: 'ccw', construction: false },
      point('a1', 43.3, -10),
      point('a2', 43.3, 60), // vertical line near angle 30°
      line('cut1', 'a1', 'a2'),
      point('b1', -43.3, -10),
      point('b2', -43.3, 60), // vertical line near angle 150°
      line('cut2', 'b1', 'b2'),
    ]);
    // Click the top of the arc (angle 90°) → remove the middle piece → two sub-arcs remain.
    const outcome = applyModify(s, 'trim', [0, 50], idGen());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const result = withEdit(s, outcome.edit);
    expect(arcsOf(result)).toHaveLength(2);
    // The centre point is preserved.
    expect(points(result).some((p) => p.id === 'o')).toBe(true);
  });
});

describe('split: line and arc', () => {
  it('splits a line into two lines sharing a new interior point at continuous coords', () => {
    const s = sketch([point('a', 0, 0), point('b', 100, 0), line('t', 'a', 'b')]);
    const outcome = applyModify(s, 'split', [37.3, 0.2], idGen());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const result = withEdit(s, outcome.edit);
    const ls = lines(result);
    expect(ls).toHaveLength(2);
    const shared = ls[0]!.endId;
    expect(ls[1]!.startId).toBe(shared);
    const sharedPoint = points(result).find((p) => p.id === shared)!;
    expect(sharedPoint.x).toBeCloseTo(37.3, 6);
    // First piece keeps the original id.
    expect(ls.some((l) => l.id === 't')).toBe(true);
  });

  it('refuses to split at (or beyond) an endpoint', () => {
    const s = sketch([point('a', 0, 0), point('b', 100, 0), line('t', 'a', 'b')]);
    const outcome = applyModify(s, 'split', [0.0, 0], idGen());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toMatch(/interior/i);
  });

  it('splits an arc into two arcs sharing the split angle about the preserved centre', () => {
    const s = sketch([
      point('o', 0, 0),
      { id: 'arc', kind: 'arc', centerId: 'o', radius: 50, startAngle: 0, endAngle: Math.PI, direction: 'ccw', construction: false },
    ]);
    const outcome = applyModify(s, 'split', [0, 50], idGen()); // top of the arc, angle 90°
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const result = withEdit(s, outcome.edit);
    const as = arcsOf(result);
    expect(as).toHaveLength(2);
    // They meet at the split angle.
    expect(as.some((a) => Math.abs(a.startAngle - Math.PI / 2) < 1e-6)).toBe(true);
    expect(as.some((a) => Math.abs(a.endAngle - Math.PI / 2) < 1e-6)).toBe(true);
  });

  it('preserves construction state through a split', () => {
    const s = sketch([point('a', 0, 0, true), point('b', 100, 0, true), line('t', 'a', 'b', true)]);
    const outcome = applyModify(s, 'split', [50, 0], idGen());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    for (const l of lines(withEdit(s, outcome.edit))) expect(l.construction).toBe(true);
    for (const p of points(withEdit(s, outcome.edit))) expect(p.construction).toBe(true);
  });
});

describe('deterministic ids and preview', () => {
  it('produces identical output for identical input and id generator', () => {
    const build = (): SketchFeature =>
      sketch([point('a', 0, 0), point('b', 100, 0), line('t', 'a', 'b')]);
    const a = applyModify(build(), 'split', [40, 0], idGen());
    const b = applyModify(build(), 'split', [40, 0], idGen());
    expect(a).toEqual(b);
  });

  it('previews the removed trim piece and a split point without consuming ids', () => {
    const s = sketch([
      point('a', 0, 0),
      point('b', 120, 0),
      line('t', 'a', 'b'),
      point('c', 60, -10),
      point('d', 60, 10),
      line('cross', 'c', 'd'),
    ]);
    const trimPreview = modifyPreview(s, 'trim', [90, 0]);
    expect(trimPreview?.valid).toBe(true);
    expect((trimPreview?.removedPolyline?.length ?? 0)).toBeGreaterThan(0);

    const splitPreview = modifyPreview(s, 'split', [40, 0.5] as Point);
    expect(splitPreview?.valid).toBe(true);
    expect(splitPreview?.splitPoint?.[0]).toBeCloseTo(40, 6);

    // No curve under the cursor → no preview.
    expect(modifyPreview(s, 'trim', [60, 40])).toBeNull();
  });
});
