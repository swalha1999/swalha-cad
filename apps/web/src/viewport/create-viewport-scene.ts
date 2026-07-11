import type { CadDocumentV2, Transform } from '@swalha-cad/document';
import type { Viewport } from '@swalha-cad/renderer';
import {
  SceneSync,
  createOrthographicCamera,
  createPerspectiveCamera,
  resizeOrthographicCamera,
  resizePerspectiveCamera,
} from '@swalha-cad/renderer';
import type { Material, Mesh, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, Scene } from 'three';
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
  document: CadDocumentV2;
  projection: CameraProjection;
  /** Initially selected body id — an entity id or a derived feature body's id. */
  selectedEntityId: string | null;
  viewport: Viewport;
  /** Called with the picked body id (entity or derived feature body), or `null` on an empty-space click. */
  onSelect: (bodyId: string | null) => void;
  onTransformChange: (entityId: string, transform: Transform) => void;
  /** Optional: called when the hovered body changes (id or `null`), for tree/viewport hover sync. */
  onHover?: (bodyId: string | null) => void;
}

export interface ViewportScene {
  readonly scene: Scene;
  updateDocument(document: CadDocumentV2): void;
  /** Highlights the given body id (entity or derived feature body); attaches the move gizmo only for entities. */
  setSelection(bodyId: string | null): void;
  /** Applies the softer hover highlight to the given body id (or clears it with `null`). */
  setHover(bodyId: string | null): void;
  setProjection(projection: CameraProjection): void;
  resize(viewport: Viewport): void;
  setStandardView(view: StandardView): void;
  getActiveCamera(): PerspectiveCamera | OrthographicCamera;
  dispose(): void;
}

const HIGHLIGHT_EMISSIVE_HEX = 0x3b5bfd;
const HOVER_EMISSIVE_HEX = 0x22357a;
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
  let currentHoveredId: string | null = null;
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

  /** A body id names an entity when it matches one; otherwise it is a derived feature body. */
  function isEntityBody(id: string): boolean {
    return currentDocument.entities.some((entity) => entity.id === id);
  }

  /** Visits every synced body object — retained primitives plus derived feature solids. */
  function forEachBody(visit: (id: string, object: Mesh) => void): void {
    for (const entity of currentDocument.entities) {
      const object = sceneSync.objectFor(entity.id);
      if (object) visit(entity.id, object);
    }
    for (const feature of currentDocument.features) {
      if (feature.kind !== 'extrude') continue;
      const object = sceneSync.objectFor(feature.id);
      if (object) visit(feature.id, object);
    }
  }

  function syncGizmoAttachment(): void {
    // Only entities carry an editable transform gizmo; derived feature solids do not.
    const object = currentSelectedId && isEntityBody(currentSelectedId) ? sceneSync.objectFor(currentSelectedId) : undefined;
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

  /** Tags every body mesh (entity or derived feature body) with its id so raycasting can identify it. */
  function tagBodyIds(): void {
    forEachBody((id, object) => {
      object.userData['entityId'] = id;
    });
  }

  function applyHighlights(): void {
    forEachBody((id, object) => {
      const material = object.material as MeshStandardMaterial;
      const hex =
        id === currentSelectedId ? HIGHLIGHT_EMISSIVE_HEX : id === currentHoveredId ? HOVER_EMISSIVE_HEX : NO_HIGHLIGHT_HEX;
      material.emissive.setHex(hex);
    });
  }

  sceneSync.sync(currentDocument);
  tagBodyIds();
  applyHighlights();
  syncGizmoAttachment();

  let frameId = requestAnimationFrame(function loop() {
    controls.update();
    renderer.render(sceneSync.scene, activeCamera);
    frameId = requestAnimationFrame(loop);
  });

  let pointerDown: { x: number; y: number } | null = null;

  /** Raycasts the pointer position and returns the body id under it, or `null`. */
  function pickAt(clientX: number, clientY: number): string | null {
    const rect = options.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
    activeCamera.updateMatrixWorld(true);
    sceneSync.scene.updateMatrixWorld(true);
    return pickEntityId({ camera: activeCamera, scene: sceneSync.scene, ndcX, ndcY }) ?? null;
  }

  function handlePointerDown(event: PointerEvent): void {
    pointerDown = { x: event.clientX, y: event.clientY };
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!options.onHover) return;
    // Skip hover picking while the user is pressing (orbiting/dragging).
    if (pointerDown) return;
    const bodyId = pickAt(event.clientX, event.clientY);
    if (bodyId === currentHoveredId) return;
    options.onHover(bodyId);
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!pointerDown) return;
    const start = pointerDown;
    pointerDown = null;
    if (!isClick(start, { x: event.clientX, y: event.clientY })) return;

    // Raycasting reads matrixWorld, which is otherwise only refreshed inside
    // the render loop; pickAt updates it explicitly so a click is accurate even
    // before the next animation frame has drawn.
    options.onSelect(pickAt(event.clientX, event.clientY));
  }

  options.canvas.addEventListener('pointerdown', handlePointerDown);
  options.canvas.addEventListener('pointerup', handlePointerUp);
  options.canvas.addEventListener('pointermove', handlePointerMove);

  return {
    scene: sceneSync.scene,

    updateDocument(document) {
      currentDocument = document;
      sceneSync.sync(document);
      // Drop a hover pointing at a body that no longer exists (e.g. after a delete).
      if (currentHoveredId && !sceneSync.objectFor(currentHoveredId)) currentHoveredId = null;
      tagBodyIds();
      applyHighlights();
      syncGizmoAttachment();
    },

    setSelection(bodyId) {
      currentSelectedId = bodyId;
      applyHighlights();
      syncGizmoAttachment();
    },

    setHover(bodyId) {
      currentHoveredId = bodyId;
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
      options.canvas.removeEventListener('pointermove', handlePointerMove);
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
