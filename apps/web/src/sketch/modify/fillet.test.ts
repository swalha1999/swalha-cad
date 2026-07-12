import type { SketchConstraint, SketchEntity, SketchFeature } from '@swalha-cad/document';
import { detectSketchProfile, signedArcSweep } from '@swalha-cad/geometry';
import { describe, expect, it } from 'vitest';
import { applyFillet, computeFillet, filletPreview, type FilletPick } from './fillet.js';

/** A deterministic id generator so fillet output is assertable. */
function idGen(prefix = 'f'): () => string {
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

/** A 100×60 rectangle: corners p0(0,0) p1(100,0) p2(100,60) p3(0,60); edges l0..l3. */
function rectangle(constraints: SketchConstraint[] = []): SketchFeature {
  return sketch(
    [
      point('p0', 0, 0),
      point('p1', 100, 0),
      point('p2', 100, 60),
      point('p3', 0, 60),
      line('l0', 'p0', 'p1'), // bottom
      line('l1', 'p1', 'p2'), // right
      line('l2', 'p2', 'p3'), // top
      line('l3', 'p3', 'p0'), // left
    ],
    constraints,
  );
}

function withEdit(base: SketchFeature, edit: { entities: SketchEntity[]; constraints: SketchConstraint[] }): SketchFeature {
  return { ...base, entities: edit.entities, constraints: edit.constraints };
}

function arcsOf(feature: SketchFeature): Extract<SketchEntity, { kind: 'arc' }>[] {
  return feature.entities.filter((e): e is Extract<SketchEntity, { kind: 'arc' }> => e.kind === 'arc');
}
function pointsOf(feature: SketchFeature): Extract<SketchEntity, { kind: 'point' }>[] {
  return feature.entities.filter((e): e is Extract<SketchEntity, { kind: 'point' }> => e.kind === 'point');
}
function lineById(feature: SketchFeature, id: string): Extract<SketchEntity, { kind: 'line' }> {
  return feature.entities.find((e): e is Extract<SketchEntity, { kind: 'line' }> => e.kind === 'line' && e.id === id)!;
}
function coord(feature: SketchFeature, id: string): [number, number] {
  const p = feature.entities.find((e) => e.id === id);
  if (p?.kind !== 'point') throw new Error(`not a point: ${id}`);
  return [p.x, p.y];
}

const pickL0: FilletPick = { lineId: 'l0', point: [50, 0] };
const pickL3: FilletPick = { lineId: 'l3', point: [0, 30] };

describe('computeFillet — rectangle corner', () => {
  it('resolves the bottom-left corner into a tangent arc and retained rays', () => {
    const result = computeFillet(rectangle(), pickL0, pickL3, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.corner).toEqual([0, 0]);
    expect(result.preview.tangentA[0]).toBeCloseTo(10, 9);
    expect(result.preview.tangentA[1]).toBeCloseTo(0, 9);
    expect(result.preview.tangentB[0]).toBeCloseTo(0, 9);
    expect(result.preview.tangentB[1]).toBeCloseTo(10, 9);
    expect(result.preview.arc.center[0]).toBeCloseTo(10, 9);
    expect(result.preview.arc.center[1]).toBeCloseTo(10, 9);
    // l0 keeps its far endpoint p1; l3 keeps its far endpoint p3.
    expect(result.resolution.a.retainedPointId).toBe('p1');
    expect(result.resolution.b.retainedPointId).toBe('p3');
    expect(result.resolution.a.cornerPointId).toBe('p0');
    expect(result.resolution.b.cornerPointId).toBe('p0');
  });

  it('preview and apply agree on the tangent points', () => {
    const preview = filletPreview(rectangle(), pickL0, pickL3, 7.5);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const edit = applyFillet(rectangle(), preview.resolution, idGen());
    const edited = withEdit(rectangle(), edit);
    const arc = arcsOf(edited)[0]!;
    const l0 = lineById(edited, 'l0');
    // l0's rewritten corner endpoint is the tangent point ≈ (7.5, 0).
    const tangent = coord(edited, l0.startId === 'p1' ? l0.endId : l0.startId);
    expect(tangent[0]).toBeCloseTo(preview.preview.tangentA[0], 9);
    expect(tangent[1]).toBeCloseTo(preview.preview.tangentA[1], 9);
    expect(arc.radius).toBeCloseTo(7.5, 9);
  });
});

describe('applyFillet — entity and constraint bookkeeping', () => {
  it('rewrites both lines, adds one arc + centre point, and drops the orphaned corner point', () => {
    const edit = applyFillet(rectangle(), assertOk(computeFillet(rectangle(), pickL0, pickL3, 10)).resolution, idGen());
    const edited = withEdit(rectangle(), edit);
    // p0 is gone; two new points (tangents) + one arc-centre point replace it → net +2 points.
    expect(pointsOf(edited).some((p) => p.id === 'p0')).toBe(false);
    expect(pointsOf(edited)).toHaveLength(6); // p1,p2,p3 + tangentA + tangentB + centre
    expect(arcsOf(edited)).toHaveLength(1);
    // Lines keep their ids.
    expect(lineById(edited, 'l0')).toBeTruthy();
    expect(lineById(edited, 'l3')).toBeTruthy();
    // The arc is a genuine minor quarter-turn.
    expect(Math.abs(signedArcSweep(toArcGeometry(edited)))).toBeCloseTo(Math.PI / 2, 6);
  });

  it('removes and reports a coincident constraint anchored on the vanished corner point', () => {
    const constraints: SketchConstraint[] = [
      { id: 'co', kind: 'coincident', pointA: 'p0', pointB: 'p1' },
      { id: 'h0', kind: 'horizontal', lineId: 'l0' },
      { id: 'v3', kind: 'vertical', lineId: 'l3' },
    ];
    const base = rectangle(constraints);
    const edit = applyFillet(base, assertOk(computeFillet(base, pickL0, pickL3, 10)).resolution, idGen());
    expect(edit.removedConstraintIds).toEqual(['co']);
    const keptKinds = edit.constraints.map((c) => c.id).sort();
    expect(keptKinds).toEqual(['h0', 'v3']); // horizontal/vertical survive on the preserved line ids
  });

  it('draws new ids in a fixed order (tangentA, tangentB, centre, arc)', () => {
    const base = rectangle();
    const edit = applyFillet(base, assertOk(computeFillet(base, pickL0, pickL3, 10)).resolution, idGen('n'));
    const arc = arcsOf(withEdit(base, edit))[0]!;
    expect(arc.id).toBe('n4');
    expect(arc.centerId).toBe('n3');
  });
});

describe('applyFillet — watertight, extrudable profile', () => {
  it('yields a single closed curve-loop profile', () => {
    const base = rectangle();
    const edit = applyFillet(base, assertOk(computeFillet(base, pickL0, pickL3, 12)).resolution, idGen());
    const profile = detectSketchProfile(withEdit(base, edit));
    expect(profile.ok).toBe(true);
    if (profile.ok) expect(profile.profile.kind).toBe('curve-loop');
  });
});

describe('computeFillet — rejections', () => {
  it('rejects the same line picked twice', () => {
    const result = computeFillet(rectangle(), pickL0, { lineId: 'l0', point: [60, 0] }, 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('same-line');
  });

  it('rejects a mismatched construction state', () => {
    const base = sketch([
      point('p0', 0, 0),
      point('p1', 100, 0),
      point('p3', 0, 60),
      line('l0', 'p0', 'p1', false),
      line('l3', 'p3', 'p0', true), // construction
    ]);
    const result = computeFillet(base, pickL0, pickL3, 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('construction-mismatch');
  });

  it('rejects picking a non-line entity', () => {
    const base = sketch([
      point('p0', 0, 0),
      point('p1', 100, 0),
      point('c', 40, 40),
      line('l0', 'p0', 'p1'),
      { id: 'circ', kind: 'circle', centerId: 'c', radius: 10, construction: false },
    ]);
    const result = computeFillet(base, pickL0, { lineId: 'circ', point: [40, 30] }, 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-a-line');
  });

  it('passes through the kernel radius-too-large and radius-invalid reasons', () => {
    const small = sketch([
      point('p0', 0, 0),
      point('p1', 5, 0),
      point('p3', 0, 5),
      line('l0', 'p0', 'p1'),
      line('l3', 'p3', 'p0'),
    ]);
    expect(assertReject(computeFillet(small, pickL0, pickL3, 10))).toBe('radius-too-large');
    expect(assertReject(computeFillet(rectangle(), pickL0, pickL3, -1))).toBe('radius-invalid');
  });
});

function assertOk<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  expect(result.ok).toBe(true);
  return result as Extract<T, { ok: true }>;
}
function assertReject(result: ReturnType<typeof computeFillet>): string {
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.reason;
}
function toArcGeometry(feature: SketchFeature) {
  const arc = arcsOf(feature)[0]!;
  const c = feature.entities.find((e) => e.id === arc.centerId);
  if (c?.kind !== 'point') throw new Error('missing centre');
  return { center: [c.x, c.y] as [number, number], radius: arc.radius, startAngle: arc.startAngle, endAngle: arc.endAngle, direction: arc.direction };
}
