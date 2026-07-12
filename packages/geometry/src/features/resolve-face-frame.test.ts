import type { CadDocumentV2, CadEntity, SketchFaceSupport, SketchFeature } from '@swalha-cad/document';
import { describe, expect, it } from 'vitest';
import { length, subtract, type Vec3 } from '../math/vec3.js';
import { computeMeshBounds } from '../mesh-validation.js';
import { evaluateDocument, resolveFaceFrame } from './evaluate-document.js';

const IDENTITY = { rotationDeg: [0, 0, 0] as Vec3, scale: [1, 1, 1] as Vec3 };

function boxEntity(id: string, translation: Vec3 = [0, 0, 0], size = 40): CadEntity {
  return {
    id,
    name: id,
    primitive: { kind: 'box', width: size, height: size, depth: size },
    transform: { translation, ...IDENTITY },
    visible: true,
  };
}

function rectSketch(id: string, half: number, face?: SketchFaceSupport): SketchFeature {
  return {
    id,
    kind: 'sketch',
    name: id,
    plane: 'XY',
    ...(face ? { face } : {}),
    entities: [
      { id: `${id}p0`, kind: 'point', x: -half, y: -half, construction: false },
      { id: `${id}p1`, kind: 'point', x: half, y: -half, construction: false },
      { id: `${id}p2`, kind: 'point', x: half, y: half, construction: false },
      { id: `${id}p3`, kind: 'point', x: -half, y: half, construction: false },
      { id: `${id}l0`, kind: 'line', startId: `${id}p0`, endId: `${id}p1`, construction: false },
      { id: `${id}l1`, kind: 'line', startId: `${id}p1`, endId: `${id}p2`, construction: false },
      { id: `${id}l2`, kind: 'line', startId: `${id}p2`, endId: `${id}p3`, construction: false },
      { id: `${id}l3`, kind: 'line', startId: `${id}p3`, endId: `${id}p0`, construction: false },
    ],
    constraints: [],
    visible: true,
  };
}

function doc(entities: CadEntity[], features: CadDocumentV2['features']): CadDocumentV2 {
  return { schemaVersion: 2, units: 'mm', entities, features };
}

function approx(a: Vec3, b: Vec3, tol = 1e-6): void {
  expect(length(subtract(a, b))).toBeLessThan(tol);
}

describe('resolveFaceFrame — primitive faces', () => {
  it('resolves a box top face through the entity transform', () => {
    const d = doc([boxEntity('box', [0, 0, 100])], []);
    const result = resolveFaceFrame(d, 'box', '+z');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    approx(result.frame.origin, [0, 0, 120]); // face centre 20 above the moved centre
    approx(result.frame.normal, [0, 0, 1]);
  });

  it('moves the resolved frame when the primitive moves', () => {
    const a = resolveFaceFrame(doc([boxEntity('box', [0, 0, 0])], []), 'box', '+x');
    const b = resolveFaceFrame(doc([boxEntity('box', [5, 0, 0])], []), 'box', '+x');
    if (!a.ok || !b.ok) throw new Error('expected ok');
    approx(a.frame.origin, [20, 0, 0]);
    approx(b.frame.origin, [25, 0, 0]);
  });

  it('rejects a curved cylinder wall as not-planar', () => {
    const cyl: CadEntity = {
      id: 'cyl',
      name: 'cyl',
      primitive: { kind: 'cylinder', radius: 10, height: 40, segments: 24 },
      transform: { translation: [0, 0, 0], ...IDENTITY },
      visible: true,
    };
    const result = resolveFaceFrame(doc([cyl], []), 'cyl', 'side');
    expect(result).toEqual({ ok: false, reason: 'not-planar' });
  });

  it('reports unknown body and unknown face distinctly', () => {
    expect(resolveFaceFrame(doc([boxEntity('box')], []), 'nope', '+z')).toEqual({ ok: false, reason: 'unknown-body' });
    expect(resolveFaceFrame(doc([boxEntity('box')], []), 'box', 'side:zzz')).toEqual({ ok: false, reason: 'unknown-face' });
  });

  it('is deterministic across repeated evaluation', () => {
    const d = doc([boxEntity('box', [3, -7, 2])], []);
    expect(resolveFaceFrame(d, 'box', '+y')).toEqual(resolveFaceFrame(d, 'box', '+y'));
  });
});

describe('resolveFaceFrame — derived-solid faces', () => {
  it('resolves the top face of an extruded body', () => {
    const d = doc(
      [],
      [rectSketch('s', 5), { id: 'ex', kind: 'extrude', name: 'Extrude 1', sketchId: 's', depth: 12, direction: 'normal', visible: true }],
    );
    const result = resolveFaceFrame(d, 'ex', 'top');
    if (!result.ok) throw new Error('expected ok');
    approx(result.frame.origin, [0, 0, 12]);
    approx(result.frame.normal, [0, 0, 1]);
  });
});

describe('downstream face-supported extrusion', () => {
  it('locates a solid built on a box top face directly on that face', () => {
    const d = doc(
      [boxEntity('box', [0, 0, 0], 40)],
      [
        rectSketch('s', 5, { bodyId: 'box', faceId: '+z' }),
        { id: 'ex', kind: 'extrude', name: 'Extrude 1', sketchId: 's', depth: 5, direction: 'normal', visible: true },
      ],
    );
    const evaluated = evaluateDocument(d);
    expect(evaluated.diagnostics).toEqual([]);
    expect(evaluated.bodies.map((b) => b.id)).toEqual(['box', 'ex']);
    const derived = evaluated.bodies.find((b) => b.id === 'ex')!;
    if (derived.geometry.kind !== 'mesh') throw new Error('expected mesh body');
    const bounds = computeMeshBounds(derived.geometry.mesh)!;
    // The box +z face sits at z=20; a 10×10 sketch swept +5 lives just above it.
    expect(bounds.min[2]).toBeCloseTo(20, 6);
    expect(bounds.max[2]).toBeCloseTo(25, 6);
    expect(bounds.min[0]).toBeCloseTo(-5, 6);
    expect(bounds.max[0]).toBeCloseTo(5, 6);
    expect(bounds.min[1]).toBeCloseTo(-5, 6);
    expect(bounds.max[1]).toBeCloseTo(5, 6);
  });

  it.each([
    { faceId: '+x' as const, axis: 0, at: 20 },
    { faceId: '-y' as const, axis: 1, at: -20 },
    { faceId: '-z' as const, axis: 2, at: -20 },
  ])('sweeps outward from the $faceId face', ({ faceId, axis, at }) => {
    const d = doc(
      [boxEntity('box', [0, 0, 0], 40)],
      [
        rectSketch('s', 4, { bodyId: 'box', faceId }),
        { id: 'ex', kind: 'extrude', name: 'Extrude 1', sketchId: 's', depth: 6, direction: 'normal', visible: true },
      ],
    );
    const evaluated = evaluateDocument(d);
    expect(evaluated.diagnostics).toEqual([]);
    const derived = evaluated.bodies.find((b) => b.id === 'ex')!;
    if (derived.geometry.kind !== 'mesh') throw new Error('expected mesh body');
    const bounds = computeMeshBounds(derived.geometry.mesh)!;
    const near = at > 0 ? at : at - 6;
    const far = at > 0 ? at + 6 : at;
    expect(bounds.min[axis]).toBeCloseTo(near, 5);
    expect(bounds.max[axis]).toBeCloseTo(far, 5);
  });

  it('emits a missing-face diagnostic (no body) when the referenced face is gone', () => {
    const d = doc(
      [boxEntity('box', [0, 0, 0], 40)],
      [
        rectSketch('s', 5, { bodyId: 'box', faceId: 'side:does-not-exist' }),
        { id: 'ex', kind: 'extrude', name: 'Extrude 1', sketchId: 's', depth: 5, direction: 'normal', visible: true },
      ],
    );
    const evaluated = evaluateDocument(d);
    expect(evaluated.bodies.map((b) => b.id)).toEqual(['box']);
    expect(evaluated.diagnostics).toHaveLength(1);
    expect(evaluated.diagnostics[0]!.code).toBe('missing-face');
  });

  it('emits a missing-face diagnostic when the parent body itself is gone', () => {
    const d = doc(
      [],
      [
        rectSketch('s', 5, { bodyId: 'ghost', faceId: '+z' }),
        { id: 'ex', kind: 'extrude', name: 'Extrude 1', sketchId: 's', depth: 5, direction: 'normal', visible: true },
      ],
    );
    const evaluated = evaluateDocument(d);
    expect(evaluated.bodies).toEqual([]);
    expect(evaluated.diagnostics[0]!.code).toBe('missing-face');
  });
});
