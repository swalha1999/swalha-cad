import type { CadDocumentV1, Transform } from '@swalha-cad/document';
import type { Viewport } from '@swalha-cad/renderer';
import {
  SceneSync,
  createOrthographicCamera,
  createPerspectiveCamera,
  resizeOrthographicCamera,
  resizePerspectiveCamera,
} from '@swalha-cad/renderer';
import type { Material, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, Scene } from 'three';
import { AmbientLight, DirectionalLight, GridHelper, Vector3 } from 'three';
import type { CameraProjection } from '../store/cad-store.js';
import { createOrbitControls } from './create-orbit-controls.js';
import { createRenderer } from './create-renderer.js';
import { createTransformControls } from './create-transform-controls.js';
import { isClick } from './is-click.js';
import { pickEntityId } from './pick-entity.js';
import { transformFromObject } from './transform-from-object.js';

export type StandardView = 'front' | 'top' | 'right' | 'home';

export interface ViewportSceneOptions {
  canvas: HTMLCanvasElement;
  document: CadDocumentV1;
  projection: CameraProjection;
  selectedEntityId: string | null;
  viewport: Viewport;
  onSelect: (entityId: string | null) => void;
  onTransformChange: (entityId: string, transform: Transform) => void;
}

export interface ViewportScene {
  readonly scene: Scene;
  updateDocument(document: CadDocumentV1): void;
  setSelection(entityId: string | null): void;
  setProjection(projection: CameraProjection): void;
  resize(viewport: Viewport): void;
  setStandardView(view: StandardView): void;
  getActiveCamera(): PerspectiveCamera | OrthographicCamera;
  dispose(): void;
}

const HIGHLIGHT_EMISSIVE_HEX = 0x3b5bfd;
const NO_HIGHLIGHT_HEX = 0x000000;
const DEFAULT_CAMERA_POSITION = [140, 110, 160] as const;
const DEFAULT_ORTHOGRAPHIC_VIEW_HEIGHT = 220;

/** Unit view directions for the floating navigation controls and view cube; `home` restores the default isometric-ish angle. */
const STANDARD_VIEW_DIRECTIONS: Record<StandardView, Vector3> = {
  front: new Vector3(0, 0, 1),
  top: new Vector3(0, 1, 0),
  right: new Vector3(1, 0, 0),
  home: new Vector3(...DEFAULT_CAMERA_POSITION).normalize(),
};

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

  // Unselected geometry uses MeshStandardMaterial, which renders pure black without
  // any light in the scene; ambient + a two-sided directional key/fill pair keeps every
  // unselected body visibly lit and shaded from the default camera angle.
  const ambientLight = new AmbientLight(0xffffff, 0.7);
  const keyLight = new DirectionalLight(0xffffff, 1.2);
  keyLight.position.set(160, 220, 140);
  const fillLight = new DirectionalLight(0xffffff, 0.45);
  fillLight.position.set(-140, 90, -120);
  const groundGrid = new GridHelper(400, 40, 0xc3cad4, 0xe1e5eb);
  groundGrid.position.y = -40;
  sceneSync.scene.add(ambientLight, keyLight, fillLight, groundGrid);

  const controls = createOrbitControls(activeCamera, options.canvas);

  const transformControls = createTransformControls(activeCamera, options.canvas);
  sceneSync.scene.add(transformControls.getHelper());
  let attachedEntityId: string | null = null;

  function syncGizmoAttachment(): void {
    const object = currentSelectedId ? sceneSync.objectFor(currentSelectedId) : undefined;
    if (object) {
      transformControls.attach(object);
      attachedEntityId = currentSelectedId;
    } else {
      transformControls.detach();
      attachedEntityId = null;
    }
  }

  transformControls.addEventListener('dragging-changed', (event) => {
    controls.enabled = !event.value;
    if (event.value === false && attachedEntityId && transformControls.object) {
      options.onTransformChange(attachedEntityId, transformFromObject(transformControls.object));
    }
  });

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
  syncGizmoAttachment();

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
      syncGizmoAttachment();
    },

    setSelection(entityId) {
      currentSelectedId = entityId;
      applyHighlights();
      syncGizmoAttachment();
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
      transformControls.camera = activeCamera;
    },

    resize(viewport) {
      resizePerspectiveCamera(perspectiveCamera, viewport);
      resizeOrthographicCamera(orthographicCamera, viewport, orthoViewHeight);
      renderer.setSize(viewport.width, viewport.height, false);
    },

    setStandardView(view) {
      const distance = activeCamera.position.length() || DEFAULT_CAMERA_POSITION[0];
      const direction = STANDARD_VIEW_DIRECTIONS[view];
      activeCamera.position.copy(direction).multiplyScalar(distance);
      // Looking straight down/up the world Y axis makes the default "up" vector
      // degenerate for lookAt's basis; use Z as "up" only for that view.
      activeCamera.up.set(0, view === 'top' ? 0 : 1, view === 'top' ? 1 : 0);
      activeCamera.lookAt(0, 0, 0);
      controls.target.set(0, 0, 0);
      controls.update();
    },

    getActiveCamera() {
      return activeCamera;
    },

    dispose() {
      cancelAnimationFrame(frameId);
      options.canvas.removeEventListener('pointerdown', handlePointerDown);
      options.canvas.removeEventListener('pointerup', handlePointerUp);
      controls.dispose();
      sceneSync.scene.remove(transformControls.getHelper());
      transformControls.dispose();
      sceneSync.scene.remove(groundGrid, ambientLight, keyLight, fillLight);
      groundGrid.geometry.dispose();
      (groundGrid.material as Material).dispose();
      sceneSync.dispose();
      renderer.dispose();
    },
  };
}
