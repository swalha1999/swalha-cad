import { describe, expect, it } from 'vitest';
import type { Mesh, MeshBasicMaterial } from 'three';
import { createOriginPlanes, ORIGIN_PLANE_LABEL } from './origin-planes.js';

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
