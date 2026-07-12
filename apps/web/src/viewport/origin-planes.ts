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
  Sprite,
  SpriteMaterial,
} from 'three';

/** The three principal origin planes, keyed by their sketch-plane id. */
export type OriginPlaneId = 'XY' | 'XZ' | 'YZ';

/** Human labels shown floating on each plane (Onshape convention: XY→Top, XZ→Front, YZ→Right). */
export const ORIGIN_PLANE_LABEL: Record<OriginPlaneId, string> = { XY: 'Top', XZ: 'Front', YZ: 'Right' };

/** Half-extent (mm) of each square origin plane; large enough to frame the empty startup origin. */
const PLANE_HALF = 90;
/** Translucent SWALHA-blue fill and a slightly stronger outline, matching the reference's outlined rectangles. */
const FILL_HEX = 0x2f6bff;
const EDGE_HEX = 0x3b6fe0;
const FILL_OPACITY = 0.08;
const HOVER_FILL_OPACITY = 0.16;
const SELECT_FILL_OPACITY = 0.22;

/** Group rotations that lay a default-XY {@link PlaneGeometry} into each principal plane. */
const PLANE_ROTATION: Record<OriginPlaneId, [number, number, number]> = {
  XY: [0, 0, 0],
  XZ: [-Math.PI / 2, 0, 0],
  YZ: [0, Math.PI / 2, 0],
};

const PLANE_ORDER: OriginPlaneId[] = ['XY', 'XZ', 'YZ'];

/**
 * Builds a floating text label as a {@link Sprite}. Returns `null` when a 2D
 * canvas context is unavailable (e.g. jsdom under unit tests), so the planes
 * still render without their labels rather than throwing.
 */
function createLabelSprite(text: string): Sprite | null {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = new Color(EDGE_HEX).getStyle();
  ctx.font = '600 30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new CanvasTexture(canvas);
  const material = new SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new Sprite(material);
  sprite.scale.set(28, 14, 1);
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
    // Float the label just inside the top-left corner of the square, like the reference.
    label.position.set(-PLANE_HALF * 0.78, PLANE_HALF * 0.86, 0);
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

  return {
    objects: planes.map((plane) => plane.group),
    pickTargets: planes.map((plane) => plane.fill),

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
