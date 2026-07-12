import type { Object3D, OrthographicCamera, PerspectiveCamera } from 'three';
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
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';

/** The three principal origin planes, keyed by their sketch-plane id. */
export type OriginPlaneId = 'XY' | 'XZ' | 'YZ';

/** Human labels shown floating on each plane (Onshape convention: XY→Top, XZ→Front, YZ→Right). */
export const ORIGIN_PLANE_LABEL: Record<OriginPlaneId, string> = { XY: 'Top', XZ: 'Front', YZ: 'Right' };

/**
 * Half-extent (mm) of each square origin plane. Kept compact so the three planes
 * frame the empty startup origin with breathing room — the reference shows small,
 * centred, balanced rectangles, not walls that fill and clip through the viewport.
 */
export const PLANE_HALF = 50;
/** Translucent SWALHA-blue fill and a slightly stronger outline, matching the reference's outlined rectangles. */
const FILL_HEX = 0x2f6bff;
const EDGE_HEX = 0x3b6fe0;
const FILL_OPACITY = 0.07;
const HOVER_FILL_OPACITY = 0.15;
const SELECT_FILL_OPACITY = 0.22;

/**
 * On-screen height of each plane label as a fraction of the viewport height. Labels
 * are re-scaled every frame to hold this constant apparent size regardless of how
 * far their plane sits from the camera, so Top/Front/Right stay small and balanced
 * (an unscaled sprite balloons on the plane nearest the camera).
 */
const LABEL_SCREEN_FRACTION = 0.032;
/** Pixel size of the label canvas texture; its aspect drives the sprite's width:height. */
const LABEL_CANVAS_WIDTH = 208;
const LABEL_CANVAS_HEIGHT = 72;
const LABEL_ASPECT = LABEL_CANVAS_WIDTH / LABEL_CANVAS_HEIGHT;

/**
 * The world width/height a label sprite must adopt so it subtends {@link LABEL_SCREEN_FRACTION}
 * of the viewport height at `distance` from the camera. For a perspective camera the
 * visible world height grows with distance (so the sprite must too); for an orthographic
 * camera it is the fixed frustum height, independent of distance.
 */
export function labelWorldSize(camera: PerspectiveCamera | OrthographicCamera, distance: number): { width: number; height: number } {
  const viewHeight =
    'isPerspectiveCamera' in camera && camera.isPerspectiveCamera
      ? 2 * distance * Math.tan(((camera as PerspectiveCamera).fov * Math.PI) / 360)
      : ((camera as OrthographicCamera).top - (camera as OrthographicCamera).bottom) / (camera as OrthographicCamera).zoom;
  const height = viewHeight * LABEL_SCREEN_FRACTION;
  return { width: height * LABEL_ASPECT, height };
}

/** Group rotations that lay a default-XY {@link PlaneGeometry} into each principal plane. */
const PLANE_ROTATION: Record<OriginPlaneId, [number, number, number]> = {
  XY: [0, 0, 0],
  XZ: [-Math.PI / 2, 0, 0],
  YZ: [0, Math.PI / 2, 0],
};

const PLANE_ORDER: OriginPlaneId[] = ['XY', 'XZ', 'YZ'];

/**
 * Where each plane's label floats, as a fraction of {@link PLANE_HALF} in the plane's
 * local frame. Tuned per plane so the three labels spread out near the origin cluster
 * (each reading against its own plane) instead of stacking in the centre.
 */
const LABEL_OFFSET: Record<OriginPlaneId, [number, number]> = {
  XY: [0.56, 0.66],
  XZ: [-0.34, 0.44],
  YZ: [-0.56, 0.6],
};

/**
 * Builds a floating text label as a {@link Sprite}. Returns `null` when a 2D
 * canvas context is unavailable (e.g. jsdom under unit tests), so the planes
 * still render without their labels rather than throwing.
 */
function createLabelSprite(text: string): Sprite | null {
  const canvas = document.createElement('canvas');
  canvas.width = LABEL_CANVAS_WIDTH;
  canvas.height = LABEL_CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = new Color(EDGE_HEX).getStyle();
  // The glyphs fill most of the canvas height so the sprite's on-screen size maps
  // almost entirely to legible text rather than transparent padding.
  ctx.font = '600 52px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new CanvasTexture(canvas);
  const material = new SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new Sprite(material);
  // Actual scale is set every frame by OriginPlanes.update() to hold a constant screen size.
  sprite.scale.set(LABEL_ASPECT, 1, 1);
  return sprite;
}

/** One built origin plane: its pickable fill mesh, outline, and (optional) floating label, grouped. */
interface BuiltPlane {
  id: OriginPlaneId;
  group: Group;
  fill: Mesh;
  outline: LineSegments;
  label: Sprite | null;
}

export interface OriginPlanes {
  /** The plane groups (add these to the scene). */
  readonly objects: readonly Object3D[];
  /** The pickable fill meshes, tagged with `userData.planeId`, for raycasting. */
  readonly pickTargets: readonly Mesh[];
  /** Re-scales every label to a constant on-screen size for the given camera; call once per frame. */
  update(camera: PerspectiveCamera | OrthographicCamera): void;
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
    new LineBasicMaterial({ color: EDGE_HEX, transparent: true, opacity: 0.6 }),
  );

  const label = createLabelSprite(ORIGIN_PLANE_LABEL[id]);
  if (label) {
    // Float the label near the plane's top edge, close to the shared origin cluster
    // (like the reference), spread per plane so the three never stack on each other.
    const [ox, oy] = LABEL_OFFSET[id];
    label.position.set(PLANE_HALF * ox, PLANE_HALF * oy, 0);
  }

  group.add(fill, outline);
  if (label) group.add(label);
  return { id, group, fill, outline, label };
}

/**
 * Builds the three translucent, blue-outlined origin planes (Top/Front/Right)
 * that frame the empty startup viewport and act as sketch supports. Each plane's
 * fill mesh is tagged with its `planeId` for raycast picking; hover/selected
 * tints brighten the fill so a chosen support reads distinctly.
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
  const labelWorld = new Vector3();

  return {
    objects: planes.map((plane) => plane.group),
    pickTargets: planes.map((plane) => plane.fill),

    update(camera) {
      for (const plane of planes) {
        if (!plane.label || !plane.group.visible) continue;
        plane.label.getWorldPosition(labelWorld);
        const distance = camera.position.distanceTo(labelWorld);
        const { width, height } = labelWorldSize(camera, distance);
        plane.label.scale.set(width, height, 1);
      }
    },

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
        if (plane.label) {
          const material = plane.label.material as SpriteMaterial;
          material.map?.dispose();
          material.dispose();
        }
      }
    },
  };
}
