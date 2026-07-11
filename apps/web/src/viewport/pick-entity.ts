import type { Camera, Scene } from 'three';
import { Raycaster, Vector2 } from 'three';

export interface PickEntityParams {
  camera: Camera;
  scene: Scene;
  /** Normalized device coordinates in [-1, 1], y up. */
  ndcX: number;
  ndcY: number;
}

/**
 * Raycasts from a camera through NDC coordinates and returns the `entityId`
 * tag (set by the viewport scene on each synced mesh's `userData`) of the
 * closest hit object, or `undefined` when the ray misses or hits an
 * untagged object.
 */
export function pickEntityId({ camera, scene, ndcX, ndcY }: PickEntityParams): string | undefined {
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);
  const [hit] = raycaster.intersectObjects(scene.children, false);
  if (!hit) return undefined;
  const entityId = hit.object.userData['entityId'];
  return typeof entityId === 'string' ? entityId : undefined;
}
