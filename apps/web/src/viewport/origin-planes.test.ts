import { describe, expect, it } from 'vitest';
import type { Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { OrthographicCamera, PerspectiveCamera } from 'three';
import { PLANE_HALF, ORIGIN_PLANE_LABEL, createOriginPlanes, labelWorldSize } from './origin-planes.js';

describe('createOriginPlanes', () => {
  it('builds the three principal planes tagged with their plane ids', () => {
    const planes = createOriginPlanes();
    const ids = planes.pickTargets.map((mesh) => mesh.userData['planeId']).sort();
    expect(ids).toEqual(['XY', 'XZ', 'YZ']);
    expect(planes.objects).toHaveLength(3);
    planes.dispose();
  });

  it('maps each plane to its Onshape label', () => {
    expect(ORIGIN_PLANE_LABEL).toEqual({ XY: 'Top', XZ: 'Front', YZ: 'Right' });
  });

  it('sizes each plane compactly around the origin rather than as oversized walls', () => {
    // The reference frames the origin with compact, breathing-room planes — not
    // walls that fill and clip through the viewport.
    expect(PLANE_HALF).toBeLessThanOrEqual(60);
    expect(PLANE_HALF).toBeGreaterThanOrEqual(35);

    const planes = createOriginPlanes();
    for (const mesh of planes.pickTargets) {
      const params = (mesh.geometry as PlaneGeometry).parameters;
      expect(params.width).toBeCloseTo(PLANE_HALF * 2, 6);
      expect(params.height).toBeCloseTo(PLANE_HALF * 2, 6);
      expect(params.width).toBeLessThanOrEqual(130);
    }
    planes.dispose();
  });

  it('sizes a perspective label to a constant on-screen size regardless of plane distance', () => {
    const camera = new PerspectiveCamera(50, 1.13, 0.1, 1000);
    const near = labelWorldSize(camera, 100);
    const far = labelWorldSize(camera, 250);
    // World size scales in proportion to distance, so the projected screen size stays constant
    // — this is what keeps Top/Front/Right balanced instead of one label ballooning.
    expect(far.height / near.height).toBeCloseTo(2.5, 5);
    expect(far.width / far.height).toBeCloseTo(near.width / near.height, 6);
    // The label reads small and legible at the default framing distance — never a giant wall of text.
    const atDefault = labelWorldSize(camera, 250).height;
    expect(atDefault).toBeGreaterThan(3);
    expect(atDefault).toBeLessThan(22);
  });

  it('sizes an orthographic label from the frustum height, independent of distance', () => {
    const camera = new OrthographicCamera(-100, 100, 110, -110, 0.1, 1000);
    const nearOrtho = labelWorldSize(camera, 50);
    const farOrtho = labelWorldSize(camera, 500);
    expect(nearOrtho.height).toBeCloseTo(farOrtho.height, 6);
    expect(nearOrtho.height).toBeGreaterThan(0);
  });

  it('lays each plane into its principal orientation', () => {
    const planes = createOriginPlanes();
    const group = (id: string) => planes.objects.find((object) => object.userData['planeId'] === id)!;
    // XY (Top) is unrotated; XZ (Front) tilts about X; YZ (Right) turns about Y.
    expect(group('XY').rotation.x).toBeCloseTo(0, 6);
    expect(group('XZ').rotation.x).toBeCloseTo(-Math.PI / 2, 6);
    expect(group('YZ').rotation.y).toBeCloseTo(Math.PI / 2, 6);
    planes.dispose();
  });

  it('brightens the hovered then selected plane fill and clears them', () => {
    const planes = createOriginPlanes();
    const fill = (id: string) => planes.pickTargets.find((mesh) => mesh.userData['planeId'] === id)! as Mesh;
    const opacity = (id: string) => ((fill(id).material as MeshBasicMaterial).opacity);
    const base = opacity('XY');

    planes.setHovered('XY');
    expect(opacity('XY')).toBeGreaterThan(base);
    const hovered = opacity('XY');

    planes.setSelected('XY');
    expect(opacity('XY')).toBeGreaterThan(hovered);

    planes.setSelected(null);
    planes.setHovered(null);
    expect(opacity('XY')).toBeCloseTo(base, 6);
    planes.dispose();
  });

  it('hides and shows every plane group', () => {
    const planes = createOriginPlanes();
    planes.setVisible(false);
    expect(planes.objects.every((object) => object.visible === false)).toBe(true);
    planes.setVisible(true);
    expect(planes.objects.every((object) => object.visible === true)).toBe(true);
    planes.dispose();
  });
});
