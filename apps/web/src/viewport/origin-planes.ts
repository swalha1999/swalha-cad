import type { Object3D } from 'three';
import {
  CanvasTexture,
  Color,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';

/** The three principal origin planes, keyed by their sketch-plane id. */
export type OriginPlaneId = 'XY' | 'XZ' | 'YZ';

/** Human labels shown on each plane (Onshape convention: XY→Top, XZ→Front, YZ→Right). */
export const ORIGIN_PLANE_LABEL: Record<OriginPlaneId, string> = { XY: 'Top', XZ: 'Front', YZ: 'Right' };

/**
 * Half-extent (mm) of each square origin plane. Enlarged from the legacy 50mm so the
 * three planes fill more of the startup frame like the Onshape reference — a prominent,
 * central cluster — while still staying clear of the viewport edges (no wall-like
 * clipping): the framing invariant is asserted in create-viewport-scene.test.ts.
 */
export const PLANE_HALF = 70;
/**
 * Translucent SWALHA-blue fill and a faint hairline outline. Both are kept very subtle
 * and faded so the overlapping planes read as pale, Onshape-like guides rather than a
 * saturated block; hover/select brighten the fill so a picked support still reads.
 */
const FILL_HEX = 0x2f6bff;
const EDGE_HEX = 0x4d78e0;
const FILL_OPACITY = 0.045;
const HOVER_FILL_OPACITY = 0.11;
const SELECT_FILL_OPACITY = 0.17;
const OUTLINE_OPACITY = 0.28;
/** The plane labels are faded too, printed onto the planes rather than shouting over them. */
const LABEL_OPACITY = 0.4;

/** Pixel size of the label canvas texture; its aspect drives the label plane's width:height. */
const LABEL_CANVAS_WIDTH = 224;
const LABEL_CANVAS_HEIGHT = 80;
const LABEL_ASPECT = LABEL_CANVAS_WIDTH / LABEL_CANVAS_HEIGHT;
/** On-plane label height as a fraction of {@link PLANE_HALF}; width follows the canvas aspect. */
const LABEL_HEIGHT_FRACTION = 0.17;
const LABEL_HEIGHT = PLANE_HALF * LABEL_HEIGHT_FRACTION;
const LABEL_WIDTH = LABEL_HEIGHT * LABEL_ASPECT;

/** Group rotations that lay a default-XY {@link PlaneGeometry} into each principal plane. */
const PLANE_ROTATION: Record<OriginPlaneId, [number, number, number]> = {
  XY: [0, 0, 0],
  XZ: [-Math.PI / 2, 0, 0],
  YZ: [0, Math.PI / 2, 0],
};

const PLANE_ORDER: OriginPlaneId[] = ['XY', 'XZ', 'YZ'];

/**
 * Where each plane's label sits, as a fraction of {@link PLANE_HALF} in the plane's
 * local frame, tuned toward a tasteful edge/corner of each plane (near the origin
 * cluster) so the three spread out and each reads against its own plane.
 */
const LABEL_OFFSET: Record<OriginPlaneId, [number, number]> = {
  // Local-frame offsets under the Z-up home view. XY (Top): local +x→world +X, local
  // +y→world +Y — nudge toward the plane's far (back) edge so "Top" sits near the top
  // of the horizontal diamond. XZ (Front): local +x→world +X, local +y→world -Z, so a
  // negative local y lifts the label toward the upper-left of the front wall. YZ
  // (Right): local +x→world -Z, local +y→world +Y, so a negative local x lifts it
  // toward the top of the right wall.
  XY: [-0.16, 0.6],
  XZ: [-0.52, -0.62],
  YZ: [-0.58, 0.14],
};

/**
 * In-plane label rotations (applied in the plane group's local frame) chosen so each
 * label — though coplanar with its plane and inheriting the plane's 3D orientation —
 * still reads upright and left-to-right from the default Z-up home camera instead of
 * mirrored or upside down. XY needs no roll; XZ flips about its local x to face the
 * front camera the right way up; YZ rolls a quarter turn so its baseline runs along
 * world +Y up the right wall.
 */
const LABEL_ROTATION: Record<OriginPlaneId, [number, number, number]> = {
  XY: [0, 0, 0],
  XZ: [Math.PI, 0, 0],
  YZ: [0, 0, Math.PI / 2],
};

/**
 * Builds the label's canvas texture, or `null` when a 2D canvas context is unavailable
 * (e.g. jsdom under unit tests). The label mesh itself is always built so its geometry,
 * placement, and orientation stay testable; only the drawn glyphs are skipped here.
 */
function createLabelTexture(text: string): CanvasTexture | null {
  const canvas = document.createElement('canvas');
  canvas.width = LABEL_CANVAS_WIDTH;
  canvas.height = LABEL_CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = new Color(EDGE_HEX).getStyle();
  // The glyphs fill most of the canvas height so the label's on-plane size maps almost
  // entirely to legible text rather than transparent padding.
  ctx.font = '600 54px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  return new CanvasTexture(canvas);
}

/**
 * Builds one plane label as a faded, coplanar {@link Mesh} that is added to the plane's
 * group — so it inherits the plane's orientation and foreshortening (printed on the 3D
 * plane) rather than billboarding to face the camera. Its in-plane roll keeps it legible
 * from the home camera; DoubleSide + no depth test let it read over the fills from either
 * side.
 */
function createLabelMesh(id: OriginPlaneId): Mesh {
  const geometry = new PlaneGeometry(LABEL_WIDTH, LABEL_HEIGHT);
  const texture = createLabelTexture(ORIGIN_PLANE_LABEL[id]);
  const material = new MeshBasicMaterial({
    color: 0xffffff,
    map: texture,
    transparent: true,
    opacity: LABEL_OPACITY,
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const label = new Mesh(geometry, material);
  label.userData['planeId'] = id;
  label.renderOrder = 3;
  const [ox, oy] = LABEL_OFFSET[id];
  label.position.set(PLANE_HALF * ox, PLANE_HALF * oy, 0);
  label.rotation.set(...LABEL_ROTATION[id]);
  return label;
}

/** One built origin plane: its pickable fill mesh, outline, and printed-on label, grouped. */
interface BuiltPlane {
  id: OriginPlaneId;
  group: Group;
  fill: Mesh;
  outline: LineSegments;
  label: Mesh;
}

export interface OriginPlanes {
  /** The plane groups (add these to the scene). */
  readonly objects: readonly Object3D[];
  /** The pickable fill meshes, tagged with `userData.planeId`, for raycasting. */
  readonly pickTargets: readonly Mesh[];
  /** The printed-on-plane label meshes, in the same order as {@link objects}. */
  readonly labels: readonly Mesh[];
  /** Shows or hides every origin plane. */
  setVisible(visible: boolean): void;
  /** Applies the hover tint to one plane (or clears every hover with `null`). */
  setHovered(id: OriginPlaneId | null): void;
  /** Applies the stronger selected tint to one plane (or clears it with `null`). */
  setSelected(id: OriginPlaneId | null): void;
  /** Releases every geometry/material/texture owned by the planes. */
  dispose(): void;
}

function buildPlane(id: OriginPlaneId): BuiltPlane {
  const group = new Group();
  group.rotation.set(...PLANE_ROTATION[id]);
  group.userData['planeId'] = id;

  const geometry = new PlaneGeometry(PLANE_HALF * 2, PLANE_HALF * 2);
  const fill = new Mesh(
    geometry,
    new MeshBasicMaterial({ color: FILL_HEX, transparent: true, opacity: FILL_OPACITY, side: DoubleSide, depthWrite: false }),
  );
  fill.userData['planeId'] = id;
  fill.renderOrder = 1;

  const outline = new LineSegments(
    new EdgesGeometry(geometry),
    new LineBasicMaterial({ color: EDGE_HEX, transparent: true, opacity: OUTLINE_OPACITY }),
  );
  outline.renderOrder = 2;

  const label = createLabelMesh(id);

  group.add(fill, outline, label);
  return { id, group, fill, outline, label };
}

/**
 * Builds the three translucent, blue-outlined origin planes (Top/Front/Right)
 * that frame the empty startup viewport and act as sketch supports. Each plane's
 * fill mesh is tagged with its `planeId` for raycast picking; hover/selected
 * tints brighten the fill so a chosen support reads distinctly. Each plane also
 * carries a faded label printed onto its 3D surface (co-planar, not billboarded).
 */
export function createOriginPlanes(): OriginPlanes {
  const planes = PLANE_ORDER.map(buildPlane);
  const byId = new Map(planes.map((plane) => [plane.id, plane] as const));

  function applyOpacity(): void {
    for (const plane of planes) {
      const material = plane.fill.material as MeshBasicMaterial;
      material.opacity =
        plane.id === selectedId ? SELECT_FILL_OPACITY : plane.id === hoveredId ? HOVER_FILL_OPACITY : FILL_OPACITY;
    }
  }

  let hoveredId: OriginPlaneId | null = null;
  let selectedId: OriginPlaneId | null = null;

  return {
    objects: planes.map((plane) => plane.group),
    pickTargets: planes.map((plane) => plane.fill),
    labels: planes.map((plane) => plane.label),

    setVisible(visible) {
      for (const plane of planes) plane.group.visible = visible;
    },

    setHovered(id) {
      if (id === hoveredId) return;
      hoveredId = id && byId.has(id) ? id : null;
      applyOpacity();
    },

    setSelected(id) {
      if (id === selectedId) return;
      selectedId = id && byId.has(id) ? id : null;
      applyOpacity();
    },

    dispose() {
      for (const plane of planes) {
        plane.group.clear();
        plane.fill.geometry.dispose();
        (plane.fill.material as MeshBasicMaterial).dispose();
        plane.outline.geometry.dispose();
        (plane.outline.material as LineBasicMaterial).dispose();
        plane.label.geometry.dispose();
        const labelMaterial = plane.label.material as MeshBasicMaterial;
        labelMaterial.map?.dispose();
        labelMaterial.dispose();
      }
    },
  };
}
