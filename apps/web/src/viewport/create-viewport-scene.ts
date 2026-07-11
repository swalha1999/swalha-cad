import type { CadDocumentV1 } from '@swalha-cad/document';
import type { Viewport } from '@swalha-cad/renderer';
import {
  SceneSync,
  createOrthographicCamera,
  createPerspectiveCamera,
  resizeOrthographicCamera,
  resizePerspectiveCamera,
} from '@swalha-cad/renderer';
import type { MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, Scene } from 'three';
import type { CameraProjection } from '../store/cad-store.js';
import { createOrbitControls } from './create-orbit-controls.js';
import { createRenderer } from './create-renderer.js';
import { isClick } from './is-click.js';
import { pickEntityId } from './pick-entity.js';

export interface ViewportSceneOptions {
  canvas: HTMLCanvasElement;
  document: CadDocumentV1;
  projection: CameraProjection;
  selectedEntityId: string | null;
  viewport: Viewport;
  onSelect: (entityId: string | null) => void;
}

export interface ViewportScene {
  readonly scene: Scene;
  updateDocument(document: CadDocumentV1): void;
  setSelection(entityId: string | null): void;
  setProjection(projection: CameraProjection): void;
  resize(viewport: Viewport): void;
  getActiveCamera(): PerspectiveCamera | OrthographicCamera;
  dispose(): void;
}

const HIGHLIGHT_EMISSIVE_HEX = 0x3b5bfd;
const NO_HIGHLIGHT_HEX = 0x000000;
const DEFAULT_CAMERA_POSITION = [140, 110, 160] as const;
const DEFAULT_ORTHOGRAPHIC_VIEW_HEIGHT = 220;

/**
 * Owns every WebGL/DOM resource for one viewport instance: the renderer,
 * both cameras, orbit controls, the render loop, and click-to-select
 * pointer handling. All of it is released by {@link ViewportScene.dispose},
 * so a React component only has to call this once per mount/unmount.
 */
export function createViewportScene(options: ViewportSceneOptions): ViewportScene {
  const sceneSync = new SceneSync();
  const renderer = createRenderer(options.canvas);
  renderer.setSize(options.viewport.width, options.viewport.height, false);

  const perspectiveCamera = createPerspectiveCamera(options.viewport);
  const orthographicCamera = createOrthographicCamera(options.viewport, {
    viewHeight: DEFAULT_ORTHOGRAPHIC_VIEW_HEIGHT,
  });
  for (const camera of [perspectiveCamera, orthographicCamera]) {
    camera.position.set(...DEFAULT_CAMERA_POSITION);
    camera.lookAt(0, 0, 0);
  }

  let activeCamera: PerspectiveCamera | OrthographicCamera =
    options.projection === 'perspective' ? perspectiveCamera : orthographicCamera;
  let currentProjection = options.projection;
  let currentDocument = options.document;
  let currentSelectedId = options.selectedEntityId;
  const orthoViewHeight = DEFAULT_ORTHOGRAPHIC_VIEW_HEIGHT;

  const controls = createOrbitControls(activeCamera, options.canvas);

  function tagEntityIds(): void {
    for (const entity of currentDocument.entities) {
      const object = sceneSync.objectFor(entity.id);
      if (object) object.userData['entityId'] = entity.id;
    }
  }

  function applyHighlights(): void {
    for (const entity of currentDocument.entities) {
      const object = sceneSync.objectFor(entity.id);
      if (!object) continue;
      const material = object.material as MeshStandardMaterial;
      material.emissive.setHex(entity.id === currentSelectedId ? HIGHLIGHT_EMISSIVE_HEX : NO_HIGHLIGHT_HEX);
    }
  }

  sceneSync.sync(currentDocument);
  tagEntityIds();
  applyHighlights();

  let frameId = requestAnimationFrame(function loop() {
    controls.update();
    renderer.render(sceneSync.scene, activeCamera);
    frameId = requestAnimationFrame(loop);
  });

  let pointerDown: { x: number; y: number } | null = null;

  function handlePointerDown(event: PointerEvent): void {
    pointerDown = { x: event.clientX, y: event.clientY };
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!pointerDown) return;
    const start = pointerDown;
    pointerDown = null;
    if (!isClick(start, { x: event.clientX, y: event.clientY })) return;

    const rect = options.canvas.getBoundingClientRect();
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    // Raycasting reads matrixWorld, which is otherwise only refreshed inside
    // the render loop; update it explicitly so a click is accurate even
    // before the next animation frame has drawn.
    activeCamera.updateMatrixWorld(true);
    sceneSync.scene.updateMatrixWorld(true);
    const entityId = pickEntityId({ camera: activeCamera, scene: sceneSync.scene, ndcX, ndcY });
    options.onSelect(entityId ?? null);
  }

  options.canvas.addEventListener('pointerdown', handlePointerDown);
  options.canvas.addEventListener('pointerup', handlePointerUp);

  return {
    scene: sceneSync.scene,

    updateDocument(document) {
      currentDocument = document;
      sceneSync.sync(document);
      tagEntityIds();
      applyHighlights();
    },

    setSelection(entityId) {
      currentSelectedId = entityId;
      applyHighlights();
    },

    setProjection(projection) {
      if (projection === currentProjection) return;
      const nextCamera = projection === 'perspective' ? perspectiveCamera : orthographicCamera;
      nextCamera.position.copy(activeCamera.position);
      nextCamera.up.copy(activeCamera.up);
      activeCamera = nextCamera;
      currentProjection = projection;
      controls.object = activeCamera;
      controls.update();
    },

    resize(viewport) {
      resizePerspectiveCamera(perspectiveCamera, viewport);
      resizeOrthographicCamera(orthographicCamera, viewport, orthoViewHeight);
      renderer.setSize(viewport.width, viewport.height, false);
    },

    getActiveCamera() {
      return activeCamera;
    },

    dispose() {
      cancelAnimationFrame(frameId);
      options.canvas.removeEventListener('pointerdown', handlePointerDown);
      options.canvas.removeEventListener('pointerup', handlePointerUp);
      controls.dispose();
      sceneSync.dispose();
      renderer.dispose();
    },
  };
}
