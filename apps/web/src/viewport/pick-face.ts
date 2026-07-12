import type { Camera, Scene } from 'three';
import { Raycaster, Vector2 } from 'three';

export interface FacePick {
  /** The evaluated body under the pointer: an entity id (primitive) or a feature id (derived solid). */
  bodyId: string;
  /** That body's deterministic semantic face id for the triangle the ray hit. */
  faceId: string;
}

export interface PickFaceParams {
  camera: Camera;
  scene: Scene;
  /** Normalized device coordinates in [-1, 1], y up. */
  ndcX: number;
  ndcY: number;
}

/**
 * Raycasts from a camera through NDC coordinates and returns the semantic
 * `{ bodyId, faceId }` of the closest hit, or `null` when the ray misses or the
 * hit object carries no face provenance. The face id comes from the object's
 * `faceOfTriangle` tag (set by the viewport scene) indexed by the hit's
 * triangle index — never a transient Three.js face index that could drift
 * between rebuilds.
 */
export function pickFace({ camera, scene, ndcX, ndcY }: PickFaceParams): FacePick | null {
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);
  const [hit] = raycaster.intersectObjects(scene.children, false);
  if (!hit) return null;
  const bodyId = hit.object.userData['entityId'];
  const faceOfTriangle = hit.object.userData['faceOfTriangle'] as readonly string[] | undefined;
  if (typeof bodyId !== 'string' || !faceOfTriangle || hit.faceIndex == null) return null;
  const faceId = faceOfTriangle[hit.faceIndex];
  return typeof faceId === 'string' ? { bodyId, faceId } : null;
}
