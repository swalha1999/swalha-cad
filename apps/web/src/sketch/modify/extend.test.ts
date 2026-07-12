import type { SketchConstraint, SketchEntity, SketchFeature } from '@swalha-cad/document';
import { arcEndpoints, detectSketchProfile } from '@swalha-cad/geometry';
import { describe, expect, it } from 'vitest';
import { resolveCurve, type Point } from './curves.js';
import { applyExtend, computeExtend } from './extend.js';
import { applyModify, modifyPreview } from './index.js';

/** A deterministic id generator so extend output is assertable. */
function idGen(prefix = 'x'): () => string {
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
function withEdit(base: SketchFeature, edit: { entities: SketchEntity[]; constraints: SketchConstraint[] }): SketchFeature {
  return { ...base, entities: edit.entities, constraints: edit.constraints };
}
function pointAt(feature: SketchFeature, id: string): Point {
  const p = points(feature).find((e) => e.id === id)!;
  return [p.x, p.y];
}

describe('computeExtend: line endpoints and directions', () => {
  // A 10 mm horizontal line and a vertical boundary line at x = 20.
  const base = sketch([
    point('p0', 0, 0),
    point('p1', 10, 0),
    line('l0', 'p0', 'p1'),
    point('b0', 20, -5),
    point('b1', 20, 5),
    line('bl', 'b0', 'b1'),
  ]);

  it('extends the end endpoint collinearly to the forward boundary', () => {
    const target = resolveCurve(base, 'l0')!;
    const result = computeExtend(base, target, [9, 0.5]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.movedEnd).toBe('end');
    expect(result.plan.hitPoint[0]).toBeCloseTo(20, 6);
    expect(result.plan.hitPoint[1]).toBeCloseTo(0, 6);
    expect(result.plan.boundaryId).toBe('bl');
  });

  it('extends the start endpoint when the cursor is near it', () => {
    // Boundary on the far side (x = -20) so the start end has somewhere to go.
    const s = sketch([
      point('p0', 0, 0),
      point('p1', 10, 0),
      line('l0', 'p0', 'p1'),
      point('b0', -20, -5),
      point('b1', -20, 5),
      line('bl', 'b0', 'b1'),
    ]);
    const target = resolveCurve(s, 'l0')!;
    const result = computeExtend(s, target, [1, 0.5]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.movedEnd).toBe('start');
    expect(result.plan.hitPoint[0]).toBeCloseTo(-20, 6);
  });

  it('never selects a boundary behind the chosen endpoint', () => {
    const s = sketch([
      point('p0', 0, 0),
      point('p1', 10, 0),
      line('l0', 'p0', 'p1'),
      // Behind the end endpoint.
      point('b0', -5, -5),
      point('b1', -5, 5),
      line('behind', 'b0', 'b1'),
      // Ahead of it.
      point('f0', 25, -5),
      point('f1', 25, 5),
      line('ahead', 'f0', 'f1'),
    ]);
    const target = resolveCurve(s, 'l0')!;
    const result = computeExtend(s, target, [9, 0.5]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.boundaryId).toBe('ahead');
    expect(result.plan.hitPoint[0]).toBeCloseTo(25, 6);
  });

  it('chooses the nearest of several forward boundaries', () => {
    const s = sketch([
      point('p0', 0, 0),
      point('p1', 10, 0),
      line('l0', 'p0', 'p1'),
      point('n0', 20, -5),
      point('n1', 20, 5),
      line('near', 'n0', 'n1'),
      point('f0', 30, -5),
      point('f1', 30, 5),
      line('far', 'f0', 'f1'),
    ]);
    const target = resolveCurve(s, 'l0')!;
    const result = computeExtend(s, target, [9, 0.5]);
    expect(result.ok && result.plan.boundaryId).toBe('near');
  });
});

describe('computeExtend: line/arc and arc boundaries', () => {
  it('extends a line to the nearer of two crossings of a circle', () => {
    const s = sketch([
      point('p0', 0, 0),
      point('p1', 10, 0),
      line('l0', 'p0', 'p1'),
      point('cc', 30, 0),
      { id: 'circ', kind: 'circle', centerId: 'cc', radius: 5, construction: false },
    ]);
    const target = resolveCurve(s, 'l0')!;
    const result = computeExtend(s, target, [9, 0.5]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.hitPoint[0]).toBeCloseTo(25, 6); // near side, not the far side at x = 35
    expect(result.plan.boundaryId).toBe('circ');
  });
});

describe('computeExtend: rejections', () => {
  const withEndBoundary = (boundary: SketchEntity[]): SketchFeature =>
    sketch([point('p0', 0, 0), point('p1', 10, 0), line('l0', 'p0', 'p1'), ...boundary]);

  it('rejects a tangent graze', () => {
    // Ray y = 5 is tangent to a circle centred (20,15) r=10 at (20,5).
    const s = sketch([
      point('p0', -10, 5),
      point('p1', 0, 5),
      line('l0', 'p0', 'p1'),
      point('cc', 20, 15),
      { id: 'circ', kind: 'circle', centerId: 'cc', radius: 10, construction: false },
    ]);
    const target = resolveCurve(s, 'l0')!;
    const result = computeExtend(s, target, [-1, 5.2]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('tangent');
  });

  it('rejects a collinear overlap ahead of the endpoint', () => {
    const s = withEndBoundary([point('c0', 15, 0), point('c1', 25, 0), line('collinear', 'c0', 'c1')]);
    const target = resolveCurve(s, 'l0')!;
    const result = computeExtend(s, target, [9, 0.2]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('overlap');
  });

  it('rejects when no curve lies ahead', () => {
    const s = withEndBoundary([point('c0', -5, -5), point('c1', -5, 5), line('behind', 'c0', 'c1')]);
    const target = resolveCurve(s, 'l0')!;
    const result = computeExtend(s, target, [9, 0.5]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-forward-hit');
  });

  it('rejects an effectively-infinite reach', () => {
    const s = withEndBoundary([point('c0', 2e6, -5), point('c1', 2e6, 5), line('faraway', 'c0', 'c1')]);
    const target = resolveCurve(s, 'l0')!;
    const result = computeExtend(s, target, [9, 0.5]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('effectively-infinite');
  });

  it('rejects when the cursor is ambiguous between both endpoints', () => {
    const s = withEndBoundary([point('c0', 20, -5), point('c1', 20, 5), line('ahead', 'c0', 'c1')]);
    const target = resolveCurve(s, 'l0')!;
    const result = computeExtend(s, target, [5, 3]); // equidistant from (0,0) and (10,0)
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('ambiguous');
  });
});

describe('computeExtend: construction boundaries', () => {
  it('extends to a construction boundary while the extended line stays real', () => {
    const s = sketch([
      point('p0', 0, 0),
      point('p1', 10, 0),
      line('l0', 'p0', 'p1'),
      point('b0', 20, -5, true),
      point('b1', 20, 5, true),
      line('bl', 'b0', 'b1', true),
    ]);
    const target = resolveCurve(s, 'l0')!;
    const result = computeExtend(s, target, [9, 0.5]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.hitPoint[0]).toBeCloseTo(20, 6);

    const edit = applyExtend(s, result.plan, idGen());
    const next = withEdit(s, edit);
    const extended = lines(next).find((l) => l.id === 'l0')!;
    expect(extended.construction).toBe(false); // the extended line is not construction
    const newEnd = points(next).find((p) => p.id === extended.endId)!;
    expect(newEnd.construction).toBe(false);
  });
});

describe('applyExtend: lines', () => {
  const base = sketch([
    point('p0', 0, 0),
    point('p1', 10, 0),
    line('l0', 'p0', 'p1'),
    point('b0', 20, -5),
    point('b1', 20, 5),
    line('bl', 'b0', 'b1'),
  ]);

  it('grows the line to the boundary and drops the orphaned old endpoint', () => {
    const target = resolveCurve(base, 'l0')!;
    const result = computeExtend(base, target, [9, 0.5]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const edit = applyExtend(base, result.plan, idGen());
    const next = withEdit(base, edit);
    expect(lines(next)).toHaveLength(2); // l0 + boundary
    const l0 = lines(next).find((l) => l.id === 'l0')!;
    expect(l0.startId).toBe('p0'); // fixed end preserved
    const end = pointAt(next, l0.endId);
    expect(end[0]).toBeCloseTo(20, 6);
    expect(points(next).some((p) => p.id === 'p1')).toBe(false); // old endpoint removed
  });

  it('is deterministic for a deterministic id generator', () => {
    const target = resolveCurve(base, 'l0')!;
    const result = computeExtend(base, target, [9, 0.5]);
    if (!result.ok) throw new Error('expected ok');
    const a = applyExtend(base, result.plan, idGen());
    const b = applyExtend(base, result.plan, idGen());
    expect(a.entities).toEqual(b.entities);
    expect(a.constraints).toEqual(b.constraints);
  });

  it('keeps a horizontal constraint but removes a coincident on the vanished endpoint', () => {
    const s = sketch(
      [
        point('p0', 0, 0),
        point('p1', 10, 0),
        line('l0', 'p0', 'p1'),
        point('stray', 10, 0),
        point('b0', 20, -5),
        point('b1', 20, 5),
        line('bl', 'b0', 'b1'),
      ],
      [
        { id: 'h0', kind: 'horizontal', lineId: 'l0' },
        { id: 'co0', kind: 'coincident', pointA: 'p1', pointB: 'stray' },
      ],
    );
    const target = resolveCurve(s, 'l0')!;
    const result = computeExtend(s, target, [9, 0.5]);
    if (!result.ok) throw new Error('expected ok');
    const edit = applyExtend(s, result.plan, idGen());
    expect(edit.removedConstraintIds).toContain('co0');
    expect(edit.constraints.some((c) => c.id === 'h0')).toBe(true);
    expect(edit.constraints.some((c) => c.id === 'co0')).toBe(false);
  });

  it('fuses onto an existing corner point, closing a valid extrudable profile', () => {
    const s = sketch([
      point('p0', 0, 0),
      point('p1', 40, 0),
      point('p2', 40, 40),
      point('p3', 0, 40),
      point('p4', 0, 3), // short left edge stops above the origin corner
      line('L1', 'p0', 'p1'),
      line('L2', 'p1', 'p2'),
      line('L3', 'p2', 'p3'),
      line('L4', 'p3', 'p4'),
    ]);
    const target = resolveCurve(s, 'L4')!;
    const result = computeExtend(s, target, [0, 2]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.movedEnd).toBe('end');
    const edit = applyExtend(s, result.plan, idGen());
    const next = withEdit(s, edit);
    const l4 = lines(next).find((l) => l.id === 'L4')!;
    expect(l4.endId).toBe('p0'); // fused onto the origin corner
    expect(points(next).some((p) => p.id === 'p4')).toBe(false);
    const profile = detectSketchProfile(next);
    expect(profile.ok).toBe(true);
    if (profile.ok) expect(profile.profile.kind).toBe('line-loop');
  });
});

describe('computeExtend / applyExtend: arcs', () => {
  // Top semicircle: centre (0,0) r=30, from (-30,0) to (30,0) sweeping cw through (0,30).
  const arcSketch = (extra: SketchEntity[] = []): SketchFeature =>
    sketch([
      point('cen', 0, 0),
      { id: 'a0', kind: 'arc', centerId: 'cen', radius: 30, startAngle: Math.PI, endAngle: 0, direction: 'cw', construction: false },
      ...extra,
    ]);
  const boundaryLine: SketchEntity[] = [point('lb0', -40, -12), point('lb1', 40, -12), line('lb', 'lb0', 'lb1')];

  it('extends the end endpoint along its own circle to a line', () => {
    const s = arcSketch(boundaryLine);
    const target = resolveCurve(s, 'a0')!;
    const result = computeExtend(s, target, [29, 3]); // near the (30,0) end
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.movedEnd).toBe('end');
    expect(result.plan.hitPoint[0]).toBeCloseTo(27.4955, 3);
    expect(result.plan.hitPoint[1]).toBeCloseTo(-12, 6);

    const edit = applyExtend(s, result.plan, idGen());
    const next = withEdit(s, edit);
    expect(arcsOf(next)).toHaveLength(1);
    const arc = arcsOf(next)[0]!;
    expect(arc.centerId).toBe('cen'); // centre preserved
    expect(arc.radius).toBeCloseTo(30, 9); // radius preserved
    const ends = arcEndpoints({
      center: [0, 0],
      radius: arc.radius,
      startAngle: arc.startAngle,
      endAngle: arc.endAngle,
      direction: arc.direction,
    });
    expect(ends.end[1]).toBeCloseTo(-12, 6); // the extended end now sits on the boundary line
  });

  it('extends the start endpoint in the reverse sweep direction', () => {
    const s = arcSketch(boundaryLine);
    const target = resolveCurve(s, 'a0')!;
    const result = computeExtend(s, target, [-29, 3]); // near the (-30,0) start
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.movedEnd).toBe('start');
    expect(result.plan.hitPoint[0]).toBeCloseTo(-27.4955, 3);
    expect(result.plan.hitPoint[1]).toBeCloseTo(-12, 6);
  });

  it('extends an arc to another circle (arc-arc)', () => {
    const s = arcSketch([point('cc', 40, 0), { id: 'circ', kind: 'circle', centerId: 'cc', radius: 20, construction: false }]);
    const target = resolveCurve(s, 'a0')!;
    const result = computeExtend(s, target, [29, 3]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.boundaryId).toBe('circ');
    expect(result.plan.hitPoint[0]).toBeCloseTo(26.25, 2);
    expect(result.plan.hitPoint[1]).toBeCloseTo(-14.522, 2);
  });
});

describe('modifyPreview / applyModify: extend routing', () => {
  const base = sketch([
    point('p0', 0, 0),
    point('p1', 10, 0),
    line('l0', 'p0', 'p1'),
    point('b0', 20, -5),
    point('b1', 20, 5),
    line('bl', 'b0', 'b1'),
  ]);

  it('previews a valid extension with its polyline and hit point', () => {
    const preview = modifyPreview(base, 'extend', [9, 0.5]);
    expect(preview?.valid).toBe(true);
    expect(preview?.extensionPolyline?.length).toBeGreaterThanOrEqual(2);
    expect(preview?.hitPoint?.[0]).toBeCloseTo(20, 6);
  });

  it('previews a diagnostic when the extension is invalid', () => {
    const s = sketch([point('p0', 0, 0), point('p1', 10, 0), line('l0', 'p0', 'p1')]);
    const preview = modifyPreview(s, 'extend', [9, 0.5]);
    expect(preview?.valid).toBe(false);
    expect(preview?.message).toBeTruthy();
  });

  it('applies through applyModify and reports removed constraints', () => {
    const s = sketch(
      [
        point('p0', 0, 0),
        point('p1', 10, 0),
        line('l0', 'p0', 'p1'),
        point('stray', 10, 0),
        point('b0', 20, -5),
        point('b1', 20, 5),
        line('bl', 'b0', 'b1'),
      ],
      [{ id: 'co0', kind: 'coincident', pointA: 'p1', pointB: 'stray' }],
    );
    const outcome = applyModify(s, 'extend', [9, 0.5], idGen());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.note).toMatch(/Removed 1 constraint/);
  });
});
