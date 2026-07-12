import type { CadDocumentV2, Transform } from '@swalha-cad/document';
import type { Viewport } from '@swalha-cad/renderer';
import {
  SceneSync,
  createOrthographicCamera,
  createPerspectiveCamera,
  resizeOrthographicCamera,
  resizePerspectiveCamera,
} from '@swalha-cad/renderer';
import type { Material, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, Scene } from 'three';
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import type { CameraProjection } from '../store/cad-store.js';
import { createOrbitControls } from './create-orbit-controls.js';
import { createRenderer } from './create-renderer.js';
import { createTransformControls } from './create-transform-controls.js';
import { faceOverlayPositions } from './face-overlay.js';
import { isClick } from './is-click.js';
import { pickEntityId } from './pick-entity.js';
import type { FacePick } from './pick-face.js';
import { pickFace } from './pick-face.js';
import { transformFromObject } from './transform-from-object.js';

export type StandardView = 'front' | 'top' | 'right' | 'home';

/**
 * How the viewport interprets pointer input against the model's faces:
 * `off` — whole-body selection only (default Part Studio picking is `hover`);
 * `hover` — prehighlight the face under the pointer and select body + face on
 * click (the preselect-then-Sketch workflow); `armed` — dim the model and the
 * next face click enters a sketch on it (the Sketch-then-face workflow).
 */
export type FacePickMode = 'off' | 'hover' | 'armed';

/** A support frame for aligning the camera normal-to-face when a face sketch begins. */
export interface FaceAlignFrame {
  origin: readonly [number, number, number];
  normal: readonly [number, number, number];
  yAxis: readonly [number, number, number];
}

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
  /** Optional: called when the prehighlighted face under the pointer changes (or `null`), in `hover`/`armed` mode. */
  onFaceHover?: (pick: FacePick | null) => void;
  /** Optional: called when a face is clicked in `hover` mode (preselect-then-Sketch). */
  onFaceSelect?: (pick: FacePick) => void;
  /** Optional: called when a face is clicked in `armed` mode (Sketch-then-face), to enter a sketch on it. */
  onArmedFaceClick?: (pick: FacePick) => void;
}

export interface ViewportScene {
  readonly scene: Scene;
  updateDocument(document: CadDocumentV2): void;
  /** Highlights the given body id (entity or derived feature body); attaches the move gizmo only for entities. */
  setSelection(bodyId: string | null): void;
  /** Applies the softer hover highlight to the given body id (or clears it with `null`). */
  setHover(bodyId: string | null): void;
  /** Sets how pointer input is interpreted against model faces (see {@link FacePickMode}). */
  setFacePickMode(mode: FacePickMode): void;
  /** Highlights the given selected face distinctly from whole-body selection (or clears it with `null`). */
  setSelectedFace(pick: FacePick | null): void;
  /** Dims every body's material (or restores full opacity) so a sketch/face-pick context reads as focused. */
  setModelDimmed(dimmed: boolean): void;
  /** Orients the camera to look straight down a face's normal at its origin (used when a face sketch begins). */
  alignCameraToFace(frame: FaceAlignFrame): void;
  /** Snapshots the current camera pose so {@link restoreCamera} can return to it after a sketch. */
  snapshotCamera(): void;
  /** Restores the camera pose captured by {@link snapshotCamera} (no-op if none captured). */
  restoreCamera(): void;
  setProjection(projection: CameraProjection): void;
  resize(viewport: Viewport): void;
  setStandardView(view: StandardView): void;
  getActiveCamera(): PerspectiveCamera | OrthographicCamera;
  dispose(): void;
}

const HIGHLIGHT_EMISSIVE_HEX = 0x3b5bfd;
const HOVER_EMISSIVE_HEX = 0x22357a;
const NO_HIGHLIGHT_HEX = 0x000000;
/** Face overlay tints, deliberately brighter than the whole-body emissive so a face reads as distinct from body selection. */
const FACE_HOVER_HEX = 0x5b8cff;
const FACE_SELECT_HEX = 0x2f6bff;
/** Opacity applied to every body's material while the model is dimmed (armed face pick or an active sketch). */
const DIMMED_OPACITY = 0.3;
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

  let facePickMode: FacePickMode = 'off';
  let modelDimmed = false;
  let currentHoveredFace: FacePick | null = null;
  let currentSelectedFace: FacePick | null = null;
  // One reusable overlay mesh per slot; built lazily, always removed on dispose.
  const faceOverlays = new Map<'hover' | 'select', Mesh>();
  let cameraSnapshot: { position: Vector3; up: Vector3; target: Vector3 } | null = null;

  /**
   * Tags every body mesh (entity or derived feature body) with its id and a
   * triangle→face-id lookup so raycasting can identify both the body and the
   * exact semantic face under the pointer without storing transient face indices.
   */
  function tagBodyIds(): void {
    forEachBody((id, object) => {
      object.userData['entityId'] = id;
      const faces = sceneSync.facesFor(id);
      if (faces.length === 0) {
        delete object.userData['faceOfTriangle'];
        return;
      }
      const faceOfTriangle: string[] = [];
      for (const face of faces) {
        for (const triangle of face.triangles) faceOfTriangle[triangle] = face.id;
      }
      object.userData['faceOfTriangle'] = faceOfTriangle;
    });
  }

  function faceOverlayMaterial(hex: number): MeshBasicMaterial {
    const material = new MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.45, depthTest: true, side: DoubleSide });
    // Pull the overlay slightly toward the camera so it wins the depth test against its own face.
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;
    return material;
  }

  function clearFaceOverlay(slot: 'hover' | 'select'): void {
    const mesh = faceOverlays.get(slot);
    if (mesh) mesh.visible = false;
  }

  /** Builds/updates the highlight geometry for one face onto the matching body's transform, or hides the slot. */
  function updateFaceOverlay(slot: 'hover' | 'select', pick: FacePick | null, hex: number): void {
    if (!pick) {
      clearFaceOverlay(slot);
      return;
    }
    const body = sceneSync.objectFor(pick.bodyId);
    const face = sceneSync.facesFor(pick.bodyId).find((candidate) => candidate.id === pick.faceId);
    if (!body || !face) {
      clearFaceOverlay(slot);
      return;
    }
    const geometry = body.geometry;
    const index = geometry.getIndex();
    const position = geometry.getAttribute('position');
    if (!index || !position) {
      clearFaceOverlay(slot);
      return;
    }
    const positions = faceOverlayPositions(index.array as ArrayLike<number>, position.array as ArrayLike<number>, face.triangles);

    let mesh = faceOverlays.get(slot);
    if (!mesh) {
      mesh = new Mesh(new BufferGeometry(), faceOverlayMaterial(hex));
      mesh.renderOrder = slot === 'select' ? 3 : 2;
      faceOverlays.set(slot, mesh);
      sceneSync.scene.add(mesh);
    }
    const overlayGeometry = mesh.geometry;
    overlayGeometry.setAttribute('position', new BufferAttribute(positions, 3));
    overlayGeometry.deleteAttribute('normal');
    (mesh.material as MeshBasicMaterial).color.setHex(hex);
    // Match the owning body's world transform (identity for a derived mesh body).
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
    mesh.scale.copy(body.scale);
    mesh.visible = true;
  }

  function refreshFaceOverlays(): void {
    updateFaceOverlay('hover', facePickMode === 'off' ? null : currentHoveredFace, FACE_HOVER_HEX);
    updateFaceOverlay('select', currentSelectedFace, FACE_SELECT_HEX);
  }

  function applyHighlights(): void {
    forEachBody((id, object) => {
      const material = object.material as MeshStandardMaterial;
      const hex =
        id === currentSelectedId ? HIGHLIGHT_EMISSIVE_HEX : id === currentHoveredId ? HOVER_EMISSIVE_HEX : NO_HIGHLIGHT_HEX;
      material.emissive.setHex(hex);
    });
  }

  /** Fades every body's material to the dimmed opacity (or restores it) so a face-pick/sketch context reads as focused. */
  function applyDim(): void {
    forEachBody((_id, object) => {
      const material = object.material as MeshStandardMaterial;
      material.transparent = modelDimmed;
      material.opacity = modelDimmed ? DIMMED_OPACITY : 1;
      material.needsUpdate = true;
    });
  }

  sceneSync.sync(currentDocument);
  tagBodyIds();
  applyHighlights();
  applyDim();
  syncGizmoAttachment();

  let frameId = requestAnimationFrame(function loop() {
    controls.update();
    renderer.render(sceneSync.scene, activeCamera);
    frameId = requestAnimationFrame(loop);
  });

  let pointerDown: { x: number; y: number } | null = null;

  /** Normalized device coordinates for a client pointer position, or `null` for a zero-sized canvas. */
  function ndcAt(clientX: number, clientY: number): { ndcX: number; ndcY: number } | null {
    const rect = options.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    activeCamera.updateMatrixWorld(true);
    sceneSync.scene.updateMatrixWorld(true);
    return { ndcX: ((clientX - rect.left) / rect.width) * 2 - 1, ndcY: -(((clientY - rect.top) / rect.height) * 2 - 1) };
  }

  /** Raycasts the pointer position and returns the body id under it, or `null`. */
  function pickAt(clientX: number, clientY: number): string | null {
    const ndc = ndcAt(clientX, clientY);
    if (!ndc) return null;
    return pickEntityId({ camera: activeCamera, scene: sceneSync.scene, ...ndc }) ?? null;
  }

  /** Raycasts the pointer position and returns the semantic face under it, or `null`. */
  function pickFaceAt(clientX: number, clientY: number): FacePick | null {
    const ndc = ndcAt(clientX, clientY);
    if (!ndc) return null;
    return pickFace({ camera: activeCamera, scene: sceneSync.scene, ...ndc });
  }

  function sameFace(a: FacePick | null, b: FacePick | null): boolean {
    return a === b || (a != null && b != null && a.bodyId === b.bodyId && a.faceId === b.faceId);
  }

  function handlePointerDown(event: PointerEvent): void {
    pointerDown = { x: event.clientX, y: event.clientY };
  }

  function handlePointerMove(event: PointerEvent): void {
    // Skip hover picking while the user is pressing (orbiting/dragging).
    if (pointerDown) return;
    if (options.onHover) {
      const bodyId = pickAt(event.clientX, event.clientY);
      if (bodyId !== currentHoveredId) options.onHover(bodyId);
    }
    if (facePickMode !== 'off') {
      const pick = pickFaceAt(event.clientX, event.clientY);
      if (!sameFace(pick, currentHoveredFace)) {
        currentHoveredFace = pick;
        refreshFaceOverlays();
        options.onFaceHover?.(pick);
      }
    }
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!pointerDown) return;
    const start = pointerDown;
    pointerDown = null;
    if (!isClick(start, { x: event.clientX, y: event.clientY })) return;

    // Raycasting reads matrixWorld, which is otherwise only refreshed inside
    // the render loop; pickAt updates it explicitly so a click is accurate even
    // before the next animation frame has drawn.
    if (facePickMode === 'armed') {
      const pick = pickFaceAt(event.clientX, event.clientY);
      if (pick) options.onArmedFaceClick?.(pick);
      return;
    }
    if (facePickMode === 'hover') {
      const pick = pickFaceAt(event.clientX, event.clientY);
      // A face hit selects body + face (preselect workflow); a miss clears selection.
      if (pick) options.onFaceSelect?.(pick);
      else options.onSelect(null);
      return;
    }
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
      // Drop face picks whose owning body vanished; refresh overlays against the fresh geometry.
      if (currentHoveredFace && !sceneSync.objectFor(currentHoveredFace.bodyId)) currentHoveredFace = null;
      if (currentSelectedFace && !sceneSync.objectFor(currentSelectedFace.bodyId)) currentSelectedFace = null;
      tagBodyIds();
      applyHighlights();
      applyDim();
      refreshFaceOverlays();
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

    setFacePickMode(mode) {
      if (mode === facePickMode) return;
      facePickMode = mode;
      if (mode === 'off') {
        currentHoveredFace = null;
        options.onFaceHover?.(null);
      }
      refreshFaceOverlays();
    },

    setSelectedFace(pick) {
      currentSelectedFace = pick;
      refreshFaceOverlays();
    },

    setModelDimmed(dimmed) {
      if (dimmed === modelDimmed) return;
      modelDimmed = dimmed;
      applyDim();
    },

    alignCameraToFace(frame) {
      const origin = new Vector3(frame.origin[0], frame.origin[1], frame.origin[2]);
      const normal = new Vector3(frame.normal[0], frame.normal[1], frame.normal[2]).normalize();
      const distance = activeCamera.position.distanceTo(origin) || DEFAULT_CAMERA_POSITION[0];
      activeCamera.position.copy(origin).addScaledVector(normal, distance);
      activeCamera.up.set(frame.yAxis[0], frame.yAxis[1], frame.yAxis[2]);
      activeCamera.lookAt(origin);
      controls.target.copy(origin);
      controls.update();
    },

    snapshotCamera() {
      cameraSnapshot = { position: activeCamera.position.clone(), up: activeCamera.up.clone(), target: controls.target.clone() };
    },

    restoreCamera() {
      if (!cameraSnapshot) return;
      // Restore both cameras so whichever projection is active after a sketch shows the prior pose.
      for (const camera of [perspectiveCamera, orthographicCamera]) {
        camera.position.copy(cameraSnapshot.position);
        camera.up.copy(cameraSnapshot.up);
      }
      controls.target.copy(cameraSnapshot.target);
      controls.update();
      cameraSnapshot = null;
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
      for (const mesh of faceOverlays.values()) {
        sceneSync.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as Material).dispose();
      }
      faceOverlays.clear();
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
