import type { CadDocumentV1 } from '@swalha-cad/document';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeshStandardMaterial, PerspectiveCamera } from 'three';

const rendererState = vi.hoisted(() => ({ instances: [] as ReturnType<typeof buildFakeRenderer>[] }));
const controlsState = vi.hoisted(() => ({ instances: [] as ReturnType<typeof buildFakeControls>[] }));

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
  };
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

const { createViewportScene } = await import('./create-viewport-scene.js');

function seedDocument(): CadDocumentV1 {
  return {
    schemaVersion: 1,
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
  };
}

function buildCanvas() {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return canvas;
}

let rafSpy: ReturnType<typeof vi.fn>;
let cancelRafSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  rendererState.instances = [];
  controlsState.instances = [];
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
    });

    const ids = scene.scene.children.map((child) => child.userData['entityId']).sort();
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
    });

    scene.setSelection(null);

    for (const child of scene.scene.children) {
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
    });

    const nextDocument = seedDocument();
    nextDocument.entities = nextDocument.entities.filter((entity) => entity.id !== 'box-1');
    scene.updateDocument(nextDocument);

    expect(scene.scene.children).toHaveLength(1);
    const cylinder = scene.scene.children[0]!;
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
});
