import type { SketchEntity, SketchFeature, SketchPlane } from '@swalha-cad/document';
import { describe, expect, it } from 'vitest';
import { length, subtract, type Vec3 } from '../math/vec3.js';
import { triangleCount } from '../mesh.js';
import { extrudeSketch } from './extrude.js';

function point(id: string, x: number, y: number): SketchEntity {
  return { id, kind: 'point', x, y, construction: false };
}
function line(id: string, startId: string, endId: string): SketchEntity {
  return { id, kind: 'line', startId, endId, construction: false };
}

/** A 40×20 rectangle wound counter-clockwise with stable line ids l0..l3. */
function rectSketch(plane: SketchPlane = 'XY'): SketchFeature {
  return {
    id: 's',
    kind: 'sketch',
    name: 'Sketch 1',
    plane,
    entities: [
      point('p0', 0, 0),
      point('p1', 40, 0),
      point('p2', 40, 20),
      point('p3', 0, 20),
      line('l0', 'p0', 'p1'),
      line('l1', 'p1', 'p2'),
      line('l2', 'p2', 'p3'),
      line('l3', 'p3', 'p0'),
    ],
    constraints: [],
    visible: true,
  };
}

function circleSketch(): SketchFeature {
  return {
    id: 's',
    kind: 'sketch',
    name: 'Sketch 1',
    plane: 'XY',
    entities: [point('c', 0, 0), { id: 'circ', kind: 'circle', centerId: 'c', radius: 5, construction: false }],
    constraints: [],
    visible: true,
  };
}

function approx(a: Vec3, b: Vec3, tol = 1e-6): void {
  expect(length(subtract(a, b))).toBeLessThan(tol);
}

describe('extrudeSketch face provenance', () => {
  it('names top, bottom, and one planar side face per rectangle edge', () => {
    const result = extrudeSketch(rectSketch(), { depth: 10, direction: 'normal' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.faces.map((f) => f.id).sort();
    expect(ids).toEqual(['bottom', 'side:l0', 'side:l1', 'side:l2', 'side:l3', 'top']);
    expect(result.faces.every((f) => f.planar)).toBe(true);
  });

  it('orients the top/bottom caps along ±normal and locates them at the ring centroid', () => {
    const result = extrudeSketch(rectSketch('XY'), { depth: 10, direction: 'normal' });
    if (!result.ok) throw new Error('expected ok');
    const top = result.faces.find((f) => f.id === 'top')!;
    const bottom = result.faces.find((f) => f.id === 'bottom')!;
    approx(top.normal, [0, 0, 1]);
    approx(bottom.normal, [0, 0, -1]);
    approx(top.origin, [20, 10, 10]);
    approx(bottom.origin, [20, 10, 0]);
  });

  it('gives each side wall an in-plane outward normal', () => {
    const result = extrudeSketch(rectSketch('XY'), { depth: 10, direction: 'normal' });
    if (!result.ok) throw new Error('expected ok');
    // Bottom edge p0->p1 (along +x) faces -Y away from the interior; its centroid sits at mid-height.
    const side0 = result.faces.find((f) => f.id === 'side:l0')!;
    approx(side0.normal, [0, -1, 0]);
    approx(side0.origin, [20, 0, 5]);
    // Every side normal is perpendicular to the extrusion axis (in-plane).
    for (const face of result.faces.filter((f) => f.id.startsWith('side:'))) {
      expect(Math.abs(face.normal[2])).toBeLessThan(1e-9);
      expect(length(face.normal)).toBeCloseTo(1, 9);
    }
  });

  it('partitions every mesh triangle across exactly one face', () => {
    const result = extrudeSketch(rectSketch(), { depth: 10, direction: 'normal' });
    if (!result.ok) throw new Error('expected ok');
    const all = result.faces.flatMap((f) => f.triangles).sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: triangleCount(result.mesh) }, (_, i) => i));
    // No triangle claimed twice.
    expect(new Set(all).size).toBe(all.length);
  });

  it('reports a circle extrusion as planar caps plus one curved (non-sketchable) side face', () => {
    const result = extrudeSketch(circleSketch(), { depth: 10, direction: 'normal' });
    if (!result.ok) throw new Error('expected ok');
    const top = result.faces.find((f) => f.id === 'top')!;
    const bottom = result.faces.find((f) => f.id === 'bottom')!;
    expect(top.planar).toBe(true);
    expect(bottom.planar).toBe(true);
    const sides = result.faces.filter((f) => f.id.startsWith('side:'));
    expect(sides).toHaveLength(1);
    expect(sides[0]!.planar).toBe(false);
    expect(sides[0]!.id).toBe('side:circ');
  });

  it('is deterministic: identical geometry yields identical faces', () => {
    const a = extrudeSketch(rectSketch('XZ'), { depth: 7, direction: 'symmetric' });
    const b = extrudeSketch(rectSketch('XZ'), { depth: 7, direction: 'symmetric' });
    if (!a.ok || !b.ok) throw new Error('expected ok');
    expect(a.faces).toEqual(b.faces);
  });

  it('embeds faces through an explicit frame override (a face-supported sketch)', () => {
    // A frame offset +50 along Z with the standard XY basis: the whole solid — and
    // therefore its face origins — shift by that offset in world space.
    const frame = { origin: [0, 0, 50] as Vec3, xAxis: [1, 0, 0] as Vec3, yAxis: [0, 1, 0] as Vec3, normal: [0, 0, 1] as Vec3 };
    const result = extrudeSketch(rectSketch('XY'), { depth: 10, direction: 'normal', frame });
    if (!result.ok) throw new Error('expected ok');
    approx(result.faces.find((f) => f.id === 'top')!.origin, [20, 10, 60]);
    approx(result.faces.find((f) => f.id === 'bottom')!.origin, [20, 10, 50]);
  });
});
