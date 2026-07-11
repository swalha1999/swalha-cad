import type { CadDocumentV2 } from '@swalha-cad/document';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Object3D } from 'three';
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
    target: { set: vi.fn() },
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

  it('moves the camera to a standard view direction, preserving distance from the origin', () => {
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
    expect(camera.position.y).toBeCloseTo(0, 5);
    expect(camera.position.z).toBeCloseTo(distanceBefore, 5);

    scene.dispose();
  });

  it('moves to the top view along the world Y axis', () => {
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
    expect(camera.position.y).toBeCloseTo(distanceBefore, 5);
    expect(camera.position.z).toBeCloseTo(0, 5);

    scene.dispose();
  });

  it('restores the default home view direction', () => {
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
    expect(camera.position.x).toBeGreaterThan(0);
    expect(camera.position.y).toBeGreaterThan(0);
    expect(camera.position.z).toBeGreaterThan(0);

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
});
