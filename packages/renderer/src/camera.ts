import { OrthographicCamera, PerspectiveCamera } from 'three';

/** Pixel dimensions of the render target, used to derive camera aspect ratio. */
export interface Viewport {
  width: number;
  height: number;
}

export interface PerspectiveCameraOptions {
  fovDeg?: number;
  near?: number;
  far?: number;
}

export interface OrthographicCameraOptions {
  /** World-space (millimetre) height the frustum spans; width follows the viewport aspect. */
  viewHeight?: number;
  near?: number;
  far?: number;
}

const DEFAULT_FOV_DEG = 50;
const DEFAULT_NEAR = 0.1;
const DEFAULT_FAR = 10000;
const DEFAULT_ORTHOGRAPHIC_VIEW_HEIGHT = 100;

function aspectOf(viewport: Viewport): number {
  return viewport.width / viewport.height;
}

/** Builds the projection stage's perspective camera: a frustum matching the lecture's perspective-divide projection. */
export function createPerspectiveCamera(viewport: Viewport, options: PerspectiveCameraOptions = {}): PerspectiveCamera {
  const camera = new PerspectiveCamera(
    options.fovDeg ?? DEFAULT_FOV_DEG,
    aspectOf(viewport),
    options.near ?? DEFAULT_NEAR,
    options.far ?? DEFAULT_FAR,
  );
  camera.updateProjectionMatrix();
  return camera;
}

/** Builds the projection stage's orthographic camera: an affine frustum with no perspective divide. */
export function createOrthographicCamera(viewport: Viewport, options: OrthographicCameraOptions = {}): OrthographicCamera {
  const viewHeight = options.viewHeight ?? DEFAULT_ORTHOGRAPHIC_VIEW_HEIGHT;
  const halfHeight = viewHeight / 2;
  const halfWidth = halfHeight * aspectOf(viewport);
  const camera = new OrthographicCamera(
    -halfWidth,
    halfWidth,
    halfHeight,
    -halfHeight,
    options.near ?? DEFAULT_NEAR,
    options.far ?? DEFAULT_FAR,
  );
  camera.updateProjectionMatrix();
  return camera;
}

/** Re-derives aspect from a new viewport (e.g. a window resize) and rebuilds the projection matrix. */
export function resizePerspectiveCamera(camera: PerspectiveCamera, viewport: Viewport): void {
  camera.aspect = aspectOf(viewport);
  camera.updateProjectionMatrix();
}

/** Re-derives the symmetric frustum from a new viewport/view height and rebuilds the projection matrix. */
export function resizeOrthographicCamera(camera: OrthographicCamera, viewport: Viewport, viewHeight: number): void {
  const halfHeight = viewHeight / 2;
  const halfWidth = halfHeight * aspectOf(viewport);
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
}
