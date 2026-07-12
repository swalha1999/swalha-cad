import { describe, expect, it } from 'vitest';
import type { Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { PerspectiveCamera, Vector3 } from 'three';
import { PLANE_HALF, ORIGIN_PLANE_LABEL, createOriginPlanes } from './origin-planes.js';

/** The app's Z-up home camera, so label-readability assertions match what the user sees at startup. */
function homeCamera(aspect = 892 / 788): PerspectiveCamera {
  const camera = new PerspectiveCamera(50, aspect, 0.1, 10000);
  camera.up.set(0, 0, 1);
  camera.position.set(150, -150, 130);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

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

  it('sizes each plane substantially larger than the legacy compact planes, still framed', () => {
    // The refined startup frames the origin with prominent planes (~1.4x the old
    // 50mm half-extent) that fill more of the viewport like the reference — while
    // staying centred and clear of the edges (asserted separately in the scene test).
    expect(PLANE_HALF).toBeGreaterThan(60);
    expect(PLANE_HALF).toBeGreaterThanOrEqual(65);
    expect(PLANE_HALF).toBeLessThanOrEqual(85);

    const planes = createOriginPlanes();
    for (const mesh of planes.pickTargets) {
      const params = (mesh.geometry as PlaneGeometry).parameters;
      expect(params.width).toBeCloseTo(PLANE_HALF * 2, 6);
      expect(params.height).toBeCloseTo(PLANE_HALF * 2, 6);
      expect(params.width).toBeGreaterThanOrEqual(130);
      expect(params.width).toBeLessThanOrEqual(180);
    }
    planes.dispose();
  });

  it('renders faded, subtle fills and outlines (Onshape-like), brighter only on hover/select', () => {
    const planes = createOriginPlanes();
    const fill = planes.pickTargets[0]! as Mesh;
    const fillMaterial = fill.material as MeshBasicMaterial;
    // Fills are barely-there so three overlapping planes never read as a saturated block.
    expect(fillMaterial.transparent).toBe(true);
    expect(fillMaterial.opacity).toBeLessThanOrEqual(0.06);
    expect(fillMaterial.opacity).toBeGreaterThan(0);

    // The outline is a faint hairline, not the old bold 0.6 edge.
    const group = planes.objects[0]!;
    const outline = group.children.find(
      (child) => (child as { isLineSegments?: boolean }).isLineSegments,
    ) as { material: MeshBasicMaterial } | undefined;
    expect(outline).toBeDefined();
    expect(outline!.material.opacity).toBeLessThanOrEqual(0.35);
    expect(outline!.material.opacity).toBeGreaterThan(0);

    planes.dispose();
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

  it('prints each label onto its plane: a coplanar child mesh, not a camera-facing sprite', () => {
    const planes = createOriginPlanes();
    expect(planes.labels).toHaveLength(3);
    for (let i = 0; i < planes.labels.length; i++) {
      const label = planes.labels[i]!;
      const group = planes.objects[i]!;
      // A textured plane mesh parented to the plane group, so it inherits the plane's
      // 3D orientation and foreshortening instead of billboarding to face the camera.
      expect((label as unknown as { isSprite?: boolean }).isSprite).not.toBe(true);
      expect((label as unknown as { isMesh?: boolean }).isMesh).toBe(true);
      expect(label.geometry.type).toBe('PlaneGeometry');
      expect(label.parent).toBe(group);
      // Coplanar with its plane (no lift out along the local normal).
      expect(label.position.z).toBeCloseTo(0, 6);
      // Faded, drawn over the fills, and readable from either side.
      const material = label.material as MeshBasicMaterial;
      expect(material.transparent).toBe(true);
      expect(material.opacity).toBeLessThanOrEqual(0.5);
      expect(material.opacity).toBeGreaterThan(0);
      expect(material.depthTest).toBe(false);
    }
    planes.dispose();
  });

  it('offsets each label toward a plane edge/corner rather than the shared centre', () => {
    const planes = createOriginPlanes();
    for (const label of planes.labels) {
      const radius = Math.hypot(label.position.x, label.position.y);
      // Sits out in the plane's outer region (an edge/corner), but inside the plane bounds.
      expect(radius).toBeGreaterThan(PLANE_HALF * 0.4);
      expect(Math.abs(label.position.x)).toBeLessThan(PLANE_HALF);
      expect(Math.abs(label.position.y)).toBeLessThan(PLANE_HALF);
    }
    planes.dispose();
  });

  it('orients every label to read upright and left-to-right from the default home camera', () => {
    const planes = createOriginPlanes();
    const camera = homeCamera();
    planes.objects.forEach((object) => object.updateMatrixWorld(true));
    for (const label of planes.labels) {
      label.updateMatrixWorld(true);
      const centre = new Vector3().setFromMatrixPosition(label.matrixWorld);
      const rightTip = new Vector3(1, 0, 0).applyMatrix4(label.matrixWorld);
      const upTip = new Vector3(0, 1, 0).applyMatrix4(label.matrixWorld);
      const c = centre.clone().project(camera);
      const r = rightTip.clone().project(camera);
      const u = upTip.clone().project(camera);
      // Glyph baseline (+x) advances rightward on screen, glyph up (+y) rises: not
      // mirrored, not upside down — legible from the home view though printed in 3D.
      expect(r.x - c.x, `label ${ORIGIN_PLANE_LABEL[label.userData['planeId'] as 'XY']} reads left-to-right`).toBeGreaterThan(0);
      expect(u.y - c.y, `label ${ORIGIN_PLANE_LABEL[label.userData['planeId'] as 'XY']} reads upright`).toBeGreaterThan(0);
    }
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
