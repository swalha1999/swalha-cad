import type { CadDocumentV2 } from '@swalha-cad/document';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Object3D, Vector3 } from 'three';
import type { MeshStandardMaterial, Object3D as Object3DType, PerspectiveCamera } from 'three';

const rendererState = vi.hoisted(() => ({ instances: [] as ReturnType<typeof buildFakeRenderer>[] }));
const controlsState = vi.hoisted(() => ({ instances: [] as ReturnType<typeof buildFakeControls>[] }));
const transformControlsState = vi.hoisted(() => ({ instances: [] as ReturnType<typeof buildFakeTransformControls>[] }));

function buildFakeRenderer() {
  return {
    domElement: document.createElement('canvas'),
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
  };
}

function buildFakeControls(camera: unknown) {
  return {
    object: camera,
    target: new Vector3(),
    update: vi.fn(),
    dispose: vi.fn(),
    enabled: true,
  };
}

function buildFakeTransformControls(camera: unknown) {
  const listeners = new Map<string, Set<(event: Record<string, unknown>) => void>>();
  const helper = new Object3D();
  const instance = {
    camera,
    object: undefined as Object3DType | undefined,
    addEventListener: vi.fn((type: string, callback: (event: Record<string, unknown>) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(callback);
    }),
    removeEventListener: vi.fn(),
    attach: vi.fn((object: Object3DType) => {
      instance.object = object;
    }),
    detach: vi.fn(() => {
      instance.object = undefined;
    }),
    getHelper: vi.fn(() => helper),
    dispose: vi.fn(),
    emit(type: string, event: Record<string, unknown> = {}) {
      for (const callback of listeners.get(type) ?? []) callback({ type, ...event });
    },
  };
  return instance;
}

vi.mock('./create-renderer.js', () => ({
  createRenderer: vi.fn(() => {
    const instance = buildFakeRenderer();
    rendererState.instances.push(instance);
    return instance;
  }),
}));

vi.mock('./create-orbit-controls.js', () => ({
  createOrbitControls: vi.fn((camera: unknown) => {
    const instance = buildFakeControls(camera);
    controlsState.instances.push(instance);
    return instance;
  }),
}));

vi.mock('./create-transform-controls.js', () => ({
  createTransformControls: vi.fn((camera: unknown) => {
    const instance = buildFakeTransformControls(camera);
    transformControlsState.instances.push(instance);
    return instance;
  }),
}));

const { createViewportScene } = await import('./create-viewport-scene.js');
const { PLANE_HALF } = await import('./origin-planes.js');

function seedDocument(): CadDocumentV2 {
  return {
    schemaVersion: 2,
    units: 'mm',
    entities: [
      {
        id: 'box-1',
        name: 'Box',
        primitive: { kind: 'box', width: 10, height: 10, depth: 10 },
        transform: { translation: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
      },
      {
        id: 'cylinder-1',
        name: 'Cylinder',
        primitive: { kind: 'cylinder', radius: 20, height: 20, segments: 16 },
        transform: { translation: [80, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
      },
    ],
    features: [],
  };
}

function buildCanvas() {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return canvas;
}

/** A document with one primitive body and one extrude feature that produces a derived solid. */
function documentWithExtrude(): CadDocumentV2 {
  return {
    schemaVersion: 2,
    units: 'mm',
    entities: [
      {
        id: 'box-1',
        name: 'Box',
        primitive: { kind: 'box', width: 10, height: 10, depth: 10 },
        transform: { translation: [-40, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
      },
    ],
    features: [
      {
        id: 'sk-1',
        kind: 'sketch',
        name: 'Sketch 1',
        plane: 'XY',
        entities: [
          { id: 'p1', kind: 'point', x: 0, y: 0, construction: false },
          { id: 'p2', kind: 'point', x: 10, y: 0, construction: false },
          { id: 'p3', kind: 'point', x: 10, y: 10, construction: false },
          { id: 'p4', kind: 'point', x: 0, y: 10, construction: false },
          { id: 'l1', kind: 'line', startId: 'p1', endId: 'p2', construction: false },
          { id: 'l2', kind: 'line', startId: 'p2', endId: 'p3', construction: false },
          { id: 'l3', kind: 'line', startId: 'p3', endId: 'p4', construction: false },
          { id: 'l4', kind: 'line', startId: 'p4', endId: 'p1', construction: false },
        ],
        constraints: [],
        visible: true,
      },
      { id: 'ex-1', kind: 'extrude', name: 'Extrude 1', sketchId: 'sk-1', depth: 5, direction: 'normal', visible: true },
    ],
  };
}

let rafSpy: ReturnType<typeof vi.fn>;
let cancelRafSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  rendererState.instances = [];
  controlsState.instances = [];
  transformControlsState.instances = [];
  rafSpy = vi.fn(() => 1);
  cancelRafSpy = vi.fn();
  vi.stubGlobal('requestAnimationFrame', rafSpy);
  vi.stubGlobal('cancelAnimationFrame', cancelRafSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createViewportScene', () => {
  it('sizes the renderer to the viewport and starts a render loop', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });

    expect(rendererState.instances[0]!.setSize).toHaveBeenCalledWith(200, 200, false);
    expect(rafSpy).toHaveBeenCalled();

    scene.dispose();
  });

  it('syncs document entities into the scene and tags each mesh with its entity id', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });

    const ids = scene.scene.children
      .map((child) => child.userData['entityId'])
      .filter((id): id is string => id !== undefined)
      .sort();
    expect(ids).toEqual(['box-1', 'cylinder-1']);

    scene.dispose();
  });

  it('applies an emissive highlight only to the initially selected entity', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: 'box-1',
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });

    const box = scene.scene.children.find((child) => child.userData['entityId'] === 'box-1')!;
    const cylinder = scene.scene.children.find((child) => child.userData['entityId'] === 'cylinder-1')!;
    const boxMaterial = (box as unknown as { material: MeshStandardMaterial }).material;
    const cylinderMaterial = (cylinder as unknown as { material: MeshStandardMaterial }).material;

    expect(boxMaterial.emissive.getHex()).not.toBe(0x000000);
    expect(cylinderMaterial.emissive.getHex()).toBe(0x000000);

    scene.dispose();
  });

  it('moves the highlight when setSelection is called', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: 'box-1',
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });

    scene.setSelection('cylinder-1');

    const box = scene.scene.children.find((child) => child.userData['entityId'] === 'box-1')!;
    const cylinder = scene.scene.children.find((child) => child.userData['entityId'] === 'cylinder-1')!;
    const boxMaterial = (box as unknown as { material: MeshStandardMaterial }).material;
    const cylinderMaterial = (cylinder as unknown as { material: MeshStandardMaterial }).material;

    expect(boxMaterial.emissive.getHex()).toBe(0x000000);
    expect(cylinderMaterial.emissive.getHex()).not.toBe(0x000000);

    scene.dispose();
  });

  it('clears every highlight when setSelection(null) is called', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: 'box-1',
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });

    scene.setSelection(null);

    const entityMeshes = scene.scene.children.filter((child) => child.userData['entityId'] !== undefined);
    for (const child of entityMeshes) {
      const material = (child as unknown as { material: MeshStandardMaterial }).material;
      expect(material.emissive.getHex()).toBe(0x000000);
    }

    scene.dispose();
  });

  it('preserves the highlight for a still-selected entity after updateDocument', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: 'cylinder-1',
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });

    const nextDocument = seedDocument();
    nextDocument.entities = nextDocument.entities.filter((entity) => entity.id !== 'box-1');
    scene.updateDocument(nextDocument);

    const entityMeshes = scene.scene.children.filter((child) => child.userData['entityId'] !== undefined);
    expect(entityMeshes).toHaveLength(1);
    const cylinder = entityMeshes[0]!;
    expect(cylinder.userData['entityId']).toBe('cylinder-1');
    const material = (cylinder as unknown as { material: MeshStandardMaterial }).material;
    expect(material.emissive.getHex()).not.toBe(0x000000);

    scene.dispose();
  });

  it('switches the active camera on setProjection while preserving its position', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });

    const perspectiveCamera = scene.getActiveCamera();
    perspectiveCamera.position.set(11, 22, 33);

    scene.setProjection('orthographic');

    const orthographicCamera = scene.getActiveCamera();
    expect(orthographicCamera).not.toBe(perspectiveCamera);
    expect(orthographicCamera.position.x).toBeCloseTo(11, 10);
    expect(orthographicCamera.position.y).toBeCloseTo(22, 10);
    expect(orthographicCamera.position.z).toBeCloseTo(33, 10);
    expect(controlsState.instances[0]!.object).toBe(orthographicCamera);

    scene.dispose();
  });

  it('resizes the renderer and both cameras', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });

    scene.resize({ width: 400, height: 100 });

    expect(rendererState.instances[0]!.setSize).toHaveBeenCalledWith(400, 100, false);
    expect((scene.getActiveCamera() as PerspectiveCamera).aspect).toBeCloseTo(4, 10);

    scene.dispose();
  });

  it('selects the entity hit by a click', () => {
    const onSelect = vi.fn();
    const canvas = buildCanvas();
    const scene = createViewportScene({
      canvas,
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect,
      onTransformChange: vi.fn(),
    });

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 100 }));

    expect(onSelect).toHaveBeenCalledWith('box-1');

    scene.dispose();
  });

  it('deselects when a click misses every entity', () => {
    const onSelect = vi.fn();
    const canvas = buildCanvas();
    const scene = createViewportScene({
      canvas,
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: 'box-1',
      viewport: { width: 200, height: 200 },
      onSelect,
      onTransformChange: vi.fn(),
    });

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 199, clientY: 1 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 199, clientY: 1 }));

    expect(onSelect).toHaveBeenCalledWith(null);

    scene.dispose();
  });

  it('treats a drag beyond the click threshold as an orbit, not a selection', () => {
    const onSelect = vi.fn();
    const canvas = buildCanvas();
    const scene = createViewportScene({
      canvas,
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect,
      onTransformChange: vi.fn(),
    });

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 20, clientY: 100 }));

    expect(onSelect).not.toHaveBeenCalled();

    scene.dispose();
  });

  it('disposes the renderer, controls, scene contents, and pointer listeners', () => {
    const onSelect = vi.fn();
    const canvas = buildCanvas();
    const scene = createViewportScene({
      canvas,
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect,
      onTransformChange: vi.fn(),
    });

    scene.dispose();

    expect(rendererState.instances[0]!.dispose).toHaveBeenCalled();
    expect(controlsState.instances[0]!.dispose).toHaveBeenCalled();
    expect(scene.scene.children).toHaveLength(0);
    expect(cancelRafSpy).toHaveBeenCalled();

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 100 }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('attaches the transform gizmo to the initially selected entity', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: 'box-1',
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });

    const box = scene.scene.children.find((child) => child.userData['entityId'] === 'box-1')!;
    expect(transformControlsState.instances[0]!.attach).toHaveBeenCalledWith(box);

    scene.dispose();
  });

  it('does not attach the gizmo when nothing is selected', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });

    expect(transformControlsState.instances[0]!.attach).not.toHaveBeenCalled();

    scene.dispose();
  });

  it('moves the gizmo to the newly selected entity and detaches when selection clears', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: 'box-1',
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });
    const transformControls = transformControlsState.instances[0]!;

    scene.setSelection('cylinder-1');
    const cylinder = scene.scene.children.find((child) => child.userData['entityId'] === 'cylinder-1')!;
    expect(transformControls.attach).toHaveBeenCalledWith(cylinder);

    scene.setSelection(null);
    expect(transformControls.detach).toHaveBeenCalled();

    scene.dispose();
  });

  it('disables orbit controls while dragging and commits the transform when the drag ends', () => {
    const onTransformChange = vi.fn();
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: 'box-1',
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange,
    });
    const transformControls = transformControlsState.instances[0]!;
    const orbitControls = controlsState.instances[0]!;

    transformControls.emit('dragging-changed', { value: true });
    expect(orbitControls.enabled).toBe(false);
    expect(onTransformChange).not.toHaveBeenCalled();

    transformControls.object!.position.set(5, 6, 7);
    transformControls.emit('dragging-changed', { value: false });

    expect(orbitControls.enabled).toBe(true);
    expect(onTransformChange).toHaveBeenCalledTimes(1);
    const [entityId, transform] = onTransformChange.mock.calls[0]!;
    expect(entityId).toBe('box-1');
    expect(transform.translation).toEqual([5, 6, 7]);

    scene.dispose();
  });

  it('adds ambient and directional lights so unselected geometry is never pure black', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });

    const lightTypes = scene.scene.children.map((child) => child.type);
    expect(lightTypes).toContain('AmbientLight');
    expect(lightTypes.filter((type) => type === 'DirectionalLight')).toHaveLength(2);

    scene.dispose();
  });

  it('moves the camera to the front view along the world -Y axis, up +Z', () => {
    // Z-up CAD convention: the Front plane is XZ (normal ±Y), so the Front view
    // looks down that normal — camera on -Y, screen-up +Z.
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });
    const distanceBefore = scene.getActiveCamera().position.length();

    scene.setStandardView('front');

    const camera = scene.getActiveCamera();
    expect(camera.position.x).toBeCloseTo(0, 5);
    expect(camera.position.y).toBeCloseTo(-distanceBefore, 5);
    expect(camera.position.z).toBeCloseTo(0, 5);
    // Front stands vertical: screen-up is world +Z.
    expect(camera.up.x).toBeCloseTo(0, 5);
    expect(camera.up.y).toBeCloseTo(0, 5);
    expect(camera.up.z).toBeCloseTo(1, 5);

    scene.dispose();
  });

  it('moves the camera to the right view along the world +X axis, up +Z', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });
    const distanceBefore = scene.getActiveCamera().position.length();

    scene.setStandardView('right');

    const camera = scene.getActiveCamera();
    expect(camera.position.x).toBeCloseTo(distanceBefore, 5);
    expect(camera.position.y).toBeCloseTo(0, 5);
    expect(camera.position.z).toBeCloseTo(0, 5);
    expect(camera.up.z).toBeCloseTo(1, 5);

    scene.dispose();
  });

  it('moves to the top view along the world +Z axis, up +Y', () => {
    // Z-up: the Top plane is XY (normal +Z); the Top view looks straight down +Z,
    // with a stable screen-up of world +Y (the XY plane's y axis).
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });
    const distanceBefore = scene.getActiveCamera().position.length();

    scene.setStandardView('top');

    const camera = scene.getActiveCamera();
    expect(camera.position.x).toBeCloseTo(0, 5);
    expect(camera.position.y).toBeCloseTo(0, 5);
    expect(camera.position.z).toBeCloseTo(distanceBefore, 5);
    // Looking straight down world Z, screen-up is world +Y (not degenerate).
    expect(camera.up.x).toBeCloseTo(0, 5);
    expect(camera.up.y).toBeCloseTo(1, 5);
    expect(camera.up.z).toBeCloseTo(0, 5);

    scene.dispose();
  });

  it('restores the default Z-up home view direction (+X, -Y, +Z)', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });

    scene.setStandardView('right');
    scene.setStandardView('home');

    const camera = scene.getActiveCamera();
    // The Onshape-style home angle shows Front (-Y), Right (+X), and Top (+Z) faces.
    expect(camera.position.x).toBeGreaterThan(0);
    expect(camera.position.y).toBeLessThan(0);
    expect(camera.position.z).toBeGreaterThan(0);
    // Home keeps world Z up so orbit stays Z-up.
    expect(camera.up.z).toBeCloseTo(1, 5);

    scene.dispose();
  });

  it('reassigns the gizmo camera when the projection switches', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });
    const transformControls = transformControlsState.instances[0]!;

    scene.setProjection('orthographic');

    expect(transformControls.camera).toBe(scene.getActiveCamera());

    scene.dispose();
  });

  it('tags a derived feature body with its feature id so it can be picked', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: documentWithExtrude(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });

    const ids = scene.scene.children
      .map((child) => child.userData['entityId'])
      .filter((id): id is string => id !== undefined)
      .sort();
    expect(ids).toEqual(['box-1', 'ex-1']);

    scene.dispose();
  });

  it('highlights a selected derived feature body without attaching the transform gizmo', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: documentWithExtrude(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });

    scene.setSelection('ex-1');

    const extrude = scene.scene.children.find((child) => child.userData['entityId'] === 'ex-1')!;
    const material = (extrude as unknown as { material: MeshStandardMaterial }).material;
    expect(material.emissive.getHex()).not.toBe(0x000000);
    // Derived solids are not transform-editable, so no gizmo is attached.
    expect(transformControlsState.instances[0]!.attach).not.toHaveBeenCalled();

    scene.dispose();
  });

  it('applies a distinct hover highlight and clears it, leaving selection untouched', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: 'box-1',
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });

    scene.setHover('cylinder-1');

    const cylinder = scene.scene.children.find((child) => child.userData['entityId'] === 'cylinder-1')!;
    const cylinderMaterial = (cylinder as unknown as { material: MeshStandardMaterial }).material;
    const box = scene.scene.children.find((child) => child.userData['entityId'] === 'box-1')!;
    const boxMaterial = (box as unknown as { material: MeshStandardMaterial }).material;
    // Hover and selection use different emissive tints and both are non-black.
    expect(cylinderMaterial.emissive.getHex()).not.toBe(0x000000);
    expect(cylinderMaterial.emissive.getHex()).not.toBe(boxMaterial.emissive.getHex());

    scene.setHover(null);
    expect(cylinderMaterial.emissive.getHex()).toBe(0x000000);
    // The selected box stays highlighted throughout.
    expect(boxMaterial.emissive.getHex()).not.toBe(0x000000);

    scene.dispose();
  });

  it('reports the hovered body id through onHover on pointer move', () => {
    const onHover = vi.fn();
    const canvas = buildCanvas();
    const scene = createViewportScene({
      canvas,
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
      onHover,
    });

    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 100 }));

    expect(onHover).toHaveBeenCalledWith('box-1');

    scene.dispose();
  });

  const BOX_FACE_IDS = ['+x', '-x', '+y', '-y', '+z', '-z'];

  it('prehighlights a face on hover in hover mode and reports it through onFaceHover', () => {
    const onFaceHover = vi.fn();
    const canvas = buildCanvas();
    const scene = createViewportScene({
      canvas,
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
      onFaceHover,
    });
    scene.setFacePickMode('hover');

    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: 100 }));

    expect(onFaceHover).toHaveBeenCalledTimes(1);
    const pick = onFaceHover.mock.calls[0]![0];
    expect(pick.bodyId).toBe('box-1');
    expect(BOX_FACE_IDS).toContain(pick.faceId);
    // A hover overlay mesh (no entityId) was added to the scene.
    const overlay = scene.scene.children.find(
      (child) => child.type === 'Mesh' && child.userData['entityId'] === undefined && (child as { visible: boolean }).visible,
    );
    expect(overlay).toBeTruthy();

    scene.dispose();
  });

  it('selects body + face on a click in hover mode (preselect workflow)', () => {
    const onSelect = vi.fn();
    const onFaceSelect = vi.fn();
    const canvas = buildCanvas();
    const scene = createViewportScene({
      canvas,
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect,
      onTransformChange: vi.fn(),
      onFaceSelect,
    });
    scene.setFacePickMode('hover');

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 100 }));

    expect(onFaceSelect).toHaveBeenCalledTimes(1);
    expect(onFaceSelect.mock.calls[0]![0].bodyId).toBe('box-1');

    scene.dispose();
  });

  it('clears selection when a hover-mode click misses every face', () => {
    const onSelect = vi.fn();
    const onFaceSelect = vi.fn();
    const canvas = buildCanvas();
    const scene = createViewportScene({
      canvas,
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: 'box-1',
      viewport: { width: 200, height: 200 },
      onSelect,
      onTransformChange: vi.fn(),
      onFaceSelect,
    });
    scene.setFacePickMode('hover');

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 199, clientY: 1 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 199, clientY: 1 }));

    expect(onFaceSelect).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith(null);

    scene.dispose();
  });

  it('enters a sketch (not a body selection) on a face click in armed mode, with the model dimmed', () => {
    const onSelect = vi.fn();
    const onArmedFaceClick = vi.fn();
    const canvas = buildCanvas();
    const scene = createViewportScene({
      canvas,
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect,
      onTransformChange: vi.fn(),
      onArmedFaceClick,
    });
    scene.setFacePickMode('armed');
    scene.setModelDimmed(true);

    const box = scene.scene.children.find((child) => child.userData['entityId'] === 'box-1')!;
    const material = (box as unknown as { material: MeshStandardMaterial }).material;
    expect(material.opacity).toBeLessThan(1);
    expect(material.transparent).toBe(true);

    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 100 }));

    expect(onArmedFaceClick).toHaveBeenCalledTimes(1);
    expect(onArmedFaceClick.mock.calls[0]![0].bodyId).toBe('box-1');
    expect(onSelect).not.toHaveBeenCalled();

    scene.setModelDimmed(false);
    expect(material.opacity).toBe(1);

    scene.dispose();
  });

  it('renders the three origin planes tagged with their plane ids', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: { schemaVersion: 2, units: 'mm', entities: [], features: [] },
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });

    const planeIds = scene.scene.children
      .map((child) => child.userData['planeId'])
      .filter((id): id is string => id !== undefined)
      .sort();
    expect(planeIds).toEqual(['XY', 'XZ', 'YZ']);

    scene.dispose();
    expect(scene.scene.children).toHaveLength(0);
  });

  it('frames the origin planes centrally within the viewport without clipping', () => {
    // The empty startup workspace at the real viewport canvas aspect (~892x788).
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: { schemaVersion: 2, units: 'mm', entities: [], features: [] },
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 892, height: 788 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });

    const camera = scene.getActiveCamera();
    scene.scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    const groups = scene.scene.children.filter((child) => typeof child.userData['planeId'] === 'string');
    expect(groups).toHaveLength(3);

    let maxX = 0;
    let maxY = 0;
    let maxRadius = 0;
    for (const group of groups) {
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const ndc = new Vector3(sx * PLANE_HALF, sy * PLANE_HALF, 0).applyMatrix4(group.matrixWorld).project(camera);
          maxX = Math.max(maxX, Math.abs(ndc.x));
          maxY = Math.max(maxY, Math.abs(ndc.y));
          maxRadius = Math.max(maxRadius, Math.hypot(ndc.x, ndc.y));
        }
      }
    }

    // Every plane corner stays inside the frame with real breathing room on all sides (no wall-like clipping).
    expect(maxX).toBeLessThan(0.9);
    expect(maxY).toBeLessThan(0.8);
    // ...yet the cluster is still a prominent, central presence rather than a distant dot.
    expect(maxRadius).toBeGreaterThan(0.35);

    scene.dispose();
  });

  it('populates the support collector from a body face click in support mode', () => {
    const onSupportFaceClick = vi.fn();
    const onSupportPlaneClick = vi.fn();
    const canvas = buildCanvas();
    const scene = createViewportScene({
      canvas,
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
      onSupportFaceClick,
      onSupportPlaneClick,
    });
    scene.setFacePickMode('support');
    scene.setModelDimmed(true);

    // The box sits at the origin, projecting to canvas centre: a click hits its face.
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 100 }));

    expect(onSupportFaceClick).toHaveBeenCalledTimes(1);
    expect(onSupportFaceClick.mock.calls[0]![0].bodyId).toBe('box-1');
    expect(onSupportPlaneClick).not.toHaveBeenCalled();

    scene.dispose();
  });

  it('populates the support collector from an origin plane click when no body face is hit', () => {
    const onSupportFaceClick = vi.fn();
    const onSupportPlaneClick = vi.fn();
    const canvas = buildCanvas();
    const scene = createViewportScene({
      canvas,
      document: { schemaVersion: 2, units: 'mm', entities: [], features: [] },
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
      onSupportFaceClick,
      onSupportPlaneClick,
    });
    scene.setFacePickMode('support');

    // Empty document: a centre click misses every body but hits an origin plane.
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 100 }));

    expect(onSupportFaceClick).not.toHaveBeenCalled();
    expect(onSupportPlaneClick).toHaveBeenCalledTimes(1);
    expect(['XY', 'XZ', 'YZ']).toContain(onSupportPlaneClick.mock.calls[0]![0]);

    scene.dispose();
  });

  it('does not choose a support when a support-mode click misses both faces and planes', () => {
    const onSupportFaceClick = vi.fn();
    const onSupportPlaneClick = vi.fn();
    const canvas = buildCanvas();
    const scene = createViewportScene({
      canvas,
      document: { schemaVersion: 2, units: 'mm', entities: [], features: [] },
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
      onSupportFaceClick,
      onSupportPlaneClick,
    });
    scene.setFacePickMode('support');

    // A far-corner click looking down the isometric default view misses the planes entirely.
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 199, clientY: 1 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 199, clientY: 1 }));

    expect(onSupportFaceClick).not.toHaveBeenCalled();
    expect(onSupportPlaneClick).not.toHaveBeenCalled();

    scene.dispose();
  });

  it('highlights a distinct selected-face overlay and disposes it on teardown', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });

    const before = scene.scene.children.length;
    scene.setSelectedFace({ bodyId: 'box-1', faceId: '+z' });
    const overlay = scene.scene.children.find(
      (child) => child.type === 'Mesh' && child.userData['entityId'] === undefined && (child as { visible: boolean }).visible,
    );
    expect(overlay).toBeTruthy();
    expect(scene.scene.children.length).toBeGreaterThan(before);

    scene.dispose();
    expect(scene.scene.children).toHaveLength(0);
  });

  it('snapshots and restores the camera pose around a sketch', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: null,
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });
    const camera = scene.getActiveCamera();
    camera.position.set(50, 60, 70);
    scene.snapshotCamera();

    scene.alignCameraToFace({ origin: [0, 0, 5], normal: [0, 0, 1], yAxis: [0, 1, 0] });
    // Aligned: looking down +z, the camera sits above the face origin.
    expect(scene.getActiveCamera().position.z).toBeGreaterThan(5);

    scene.restoreCamera();
    expect(scene.getActiveCamera().position.x).toBeCloseTo(50, 5);
    expect(scene.getActiveCamera().position.y).toBeCloseTo(60, 5);
    expect(scene.getActiveCamera().position.z).toBeCloseTo(70, 5);

    scene.dispose();
  });

  it('disposes the transform gizmo and removes its helper from the scene', () => {
    const scene = createViewportScene({
      canvas: buildCanvas(),
      document: seedDocument(),
      projection: 'perspective',
      selectedEntityId: 'box-1',
      viewport: { width: 200, height: 200 },
      onSelect: vi.fn(),
      onTransformChange: vi.fn(),
    });
    const transformControls = transformControlsState.instances[0]!;

    scene.dispose();

    expect(transformControls.dispose).toHaveBeenCalled();
    expect(scene.scene.children).not.toContain(transformControls.getHelper());
  });

  describe('Z-up CAD orientation', () => {
    function emptyScene() {
      return createViewportScene({
        canvas: buildCanvas(),
        document: { schemaVersion: 2, units: 'mm', entities: [], features: [] },
        projection: 'perspective',
        selectedEntityId: null,
        viewport: { width: 200, height: 200 },
        onSelect: vi.fn(),
        onTransformChange: vi.fn(),
      });
    }

    it('starts both cameras with world +Z as the up direction', () => {
      const scene = emptyScene();
      const camera = scene.getActiveCamera();
      expect(camera.up.x).toBeCloseTo(0, 6);
      expect(camera.up.y).toBeCloseTo(0, 6);
      expect(camera.up.z).toBeCloseTo(1, 6);

      // The orthographic camera shares the same Z-up convention after a switch.
      scene.setProjection('orthographic');
      const ortho = scene.getActiveCamera();
      expect(ortho.up.z).toBeCloseTo(1, 6);

      scene.dispose();
    });

    it('positions the default home camera in the (+X, -Y, +Z) octant so Front/Right/Top read correctly', () => {
      const scene = emptyScene();
      const camera = scene.getActiveCamera();
      expect(camera.position.x).toBeGreaterThan(0);
      expect(camera.position.y).toBeLessThan(0);
      expect(camera.position.z).toBeGreaterThan(0);
      scene.dispose();
    });

    it('renders the Top plane (XY) horizontal with a +Z normal and Front/Right vertical', () => {
      const scene = emptyScene();
      scene.scene.updateMatrixWorld(true);
      const groupFor = (id: string) => scene.scene.children.find((child) => child.userData['planeId'] === id)!;
      const worldNormal = (id: string) => new Vector3(0, 0, 1).applyQuaternion(groupFor(id).quaternion).normalize();

      // Top plane normal is world up (+Z) → the plane is horizontal.
      const top = worldNormal('XY');
      expect(Math.abs(top.z)).toBeCloseTo(1, 5);
      expect(Math.abs(top.x)).toBeCloseTo(0, 5);
      expect(Math.abs(top.y)).toBeCloseTo(0, 5);

      // Front (XZ) normal lies along world ±Y → a vertical wall.
      const front = worldNormal('XZ');
      expect(Math.abs(front.y)).toBeCloseTo(1, 5);
      expect(Math.abs(front.z)).toBeCloseTo(0, 5);

      // Right (YZ) normal lies along world ±X → a vertical wall.
      const right = worldNormal('YZ');
      expect(Math.abs(right.x)).toBeCloseTo(1, 5);
      expect(Math.abs(right.z)).toBeCloseTo(0, 5);

      scene.dispose();
    });

    it('lays the ground grid on the XY plane (its normal is world +Z)', () => {
      const scene = emptyScene();
      scene.scene.updateMatrixWorld(true);
      const grid = scene.scene.children.find((child) => child.type === 'GridHelper')!;
      expect(grid).toBeTruthy();
      // A GridHelper is authored in its local XZ plane (normal +Y); on the XY ground
      // plane its world normal must point along world +Z.
      const normal = new Vector3(0, 1, 0).applyQuaternion(grid.quaternion).normalize();
      expect(Math.abs(normal.z)).toBeCloseTo(1, 5);
      expect(Math.abs(normal.x)).toBeCloseTo(0, 5);
      expect(Math.abs(normal.y)).toBeCloseTo(0, 5);
      // It sits just below the origin planes along the up (Z) axis.
      expect(grid.position.z).toBeLessThan(0);
      expect(grid.position.y).toBeCloseTo(0, 6);

      scene.dispose();
    });

    it('aligns the camera normal-to-face without roll or mirroring (screen-up = frame yAxis, right-handed)', () => {
      const scene = emptyScene();
      const origin: [number, number, number] = [0, 0, 5];
      const normal: [number, number, number] = [0, 0, 1];
      const yAxis: [number, number, number] = [0, 1, 0];
      scene.alignCameraToFace({ origin, normal, yAxis });

      const camera = scene.getActiveCamera();
      // Camera sits along +normal from the face origin and looks back down it.
      const toCamera = camera.position.clone().sub(new Vector3(...origin)).normalize();
      expect(toCamera.dot(new Vector3(...normal))).toBeCloseTo(1, 4);
      // Screen-up is exactly the frame's y axis (no roll).
      expect(camera.up.x).toBeCloseTo(yAxis[0], 5);
      expect(camera.up.y).toBeCloseTo(yAxis[1], 5);
      expect(camera.up.z).toBeCloseTo(yAxis[2], 5);

      // Screen-right (camera local +X) equals xAxis = cross(yAxis, normal) — a
      // right-handed basis, so 2D sketch X maps to screen-right with no mirror.
      camera.updateMatrixWorld(true);
      const screenRight = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      const expectedRight = new Vector3(...yAxis).cross(new Vector3(...normal)).normalize();
      expect(screenRight.dot(expectedRight)).toBeCloseTo(1, 4);

      scene.dispose();
    });
  });
});
