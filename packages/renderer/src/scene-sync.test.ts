import type {
  CadDocumentV2,
  CadEntity,
  CadFeature,
  ExtrudeFeature,
  Primitive,
  SketchEntity,
  SketchFeature,
  Transform,
} from '@swalha-cad/document';
import { composeTransformMatrix } from '@swalha-cad/geometry';
import type { Material } from 'three';
import { DoubleSide, FrontSide, Mesh } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SceneSync } from './scene-sync.js';

const IDENTITY_TRANSFORM: Transform = {
  translation: [0, 0, 0],
  rotationDeg: [0, 0, 0],
  scale: [1, 1, 1],
};

function entity(id: string, primitive: Primitive, overrides: Partial<CadEntity> = {}): CadEntity {
  return {
    id,
    name: id,
    primitive,
    transform: IDENTITY_TRANSFORM,
    visible: true,
    ...overrides,
  };
}

function documentOf(entities: CadEntity[], features: CadFeature[] = []): CadDocumentV2 {
  return { schemaVersion: 2, units: 'mm', entities, features };
}

function point(id: string, x: number, y: number): SketchEntity {
  return { id, kind: 'point', x, y, construction: false };
}

function line(id: string, startId: string, endId: string): SketchEntity {
  return { id, kind: 'line', startId, endId, construction: false };
}

function rectangleSketch(id: string): SketchFeature {
  return {
    id,
    kind: 'sketch',
    name: id,
    plane: 'XY',
    entities: [
      point('p0', 0, 0),
      point('p1', 4, 0),
      point('p2', 4, 2),
      point('p3', 0, 2),
      line('l0', 'p0', 'p1'),
      line('l1', 'p1', 'p2'),
      line('l2', 'p2', 'p3'),
      line('l3', 'p3', 'p0'),
    ],
    constraints: [],
    visible: true,
  };
}

function extrude(id: string, sketchId: string, overrides: Partial<ExtrudeFeature> = {}): ExtrudeFeature {
  return { id, kind: 'extrude', name: id, sketchId, depth: 5, direction: 'normal', visible: true, ...overrides };
}

const BOX: Primitive = { kind: 'box', width: 10, height: 20, depth: 30 };
const CYLINDER: Primitive = { kind: 'cylinder', radius: 5, height: 12, segments: 16 };

describe('SceneSync', () => {
  it('adds one mesh per entity, applying visibility and name', () => {
    const sync = new SceneSync();
    sync.sync(documentOf([entity('a', BOX), entity('b', CYLINDER, { visible: false, name: 'hidden-cyl' })]));

    expect(sync.scene.children).toHaveLength(2);
    const a = sync.objectFor('a')!;
    const b = sync.objectFor('b')!;
    expect(a.visible).toBe(true);
    expect(a.name).toBe('a');
    expect(b.visible).toBe(false);
    expect(b.name).toBe('hidden-cyl');
  });

  it('enables depth testing and back-face culling on generated materials', () => {
    const sync = new SceneSync();
    sync.sync(documentOf([entity('a', BOX)]));

    const mesh = sync.objectFor('a') as Mesh;
    const material = mesh.material as Material;
    expect(material.depthTest).toBe(true);
    expect(material.side).toBe(FrontSide);
    expect(material.side).not.toBe(DoubleSide);
  });

  it('applies the entity transform as model->world matrix matching the geometry package composition', () => {
    const transform: Transform = {
      translation: [5, -2, 8],
      rotationDeg: [15, 30, -45],
      scale: [2, 1, 0.5],
    };
    const sync = new SceneSync();
    sync.sync(documentOf([entity('a', BOX, { transform })]));

    const mesh = sync.objectFor('a')!;
    mesh.updateMatrix();
    const expected = composeTransformMatrix(transform);

    for (let i = 0; i < 16; i++) {
      expect(mesh.matrix.elements[i]).toBeCloseTo(expected[i]!, 6);
    }
  });

  it('reuses the same object and geometry across re-syncs when the primitive is unchanged', () => {
    const sync = new SceneSync();
    sync.sync(documentOf([entity('a', BOX)]));
    const meshBefore = sync.objectFor('a') as Mesh;
    const geometryBefore = meshBefore.geometry;

    const movedTransform: Transform = { translation: [1, 2, 3], rotationDeg: [0, 0, 0], scale: [1, 1, 1] };
    sync.sync(documentOf([entity('a', BOX, { transform: movedTransform })]));

    const meshAfter = sync.objectFor('a') as Mesh;
    expect(meshAfter).toBe(meshBefore);
    expect(meshAfter.geometry).toBe(geometryBefore);
    expect(meshAfter.position.toArray()).toEqual([1, 2, 3]);
  });

  it('disposes the replaced geometry when an entity primitive changes', () => {
    const sync = new SceneSync();
    sync.sync(documentOf([entity('a', BOX)]));
    const meshBefore = sync.objectFor('a') as Mesh;
    const geometryBefore = meshBefore.geometry;
    const disposeSpy = vi.spyOn(geometryBefore, 'dispose');

    sync.sync(documentOf([entity('a', CYLINDER)]));

    const meshAfter = sync.objectFor('a') as Mesh;
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(meshAfter.geometry).not.toBe(geometryBefore);
  });

  it('removes and disposes objects for entities no longer present in the document', () => {
    const sync = new SceneSync();
    sync.sync(documentOf([entity('a', BOX), entity('b', CYLINDER)]));
    const meshB = sync.objectFor('b') as Mesh;
    const geometryDispose = vi.spyOn(meshB.geometry, 'dispose');
    const materialDispose = vi.spyOn(meshB.material as Material, 'dispose');

    sync.sync(documentOf([entity('a', BOX)]));

    expect(sync.scene.children).toHaveLength(1);
    expect(sync.objectFor('b')).toBeUndefined();
    expect(sync.scene.children).not.toContain(meshB);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });

  it('dispose() clears every synced object and its GPU resources', () => {
    const sync = new SceneSync();
    sync.sync(documentOf([entity('a', BOX), entity('b', CYLINDER)]));
    const meshA = sync.objectFor('a') as Mesh;
    const geometryDispose = vi.spyOn(meshA.geometry, 'dispose');

    sync.dispose();

    expect(sync.scene.children).toHaveLength(0);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
  });

  it('adds a mesh for a visible extrude feature and omits standalone sketches', () => {
    const sync = new SceneSync();
    sync.sync(documentOf([entity('prim', BOX)], [rectangleSketch('s1'), extrude('e1', 's1')]));

    // One primitive body + one derived extrude body; the sketch is non-solid.
    expect(sync.scene.children).toHaveLength(2);
    const derived = sync.objectFor('e1');
    expect(derived).toBeDefined();
    expect(sync.objectFor('s1')).toBeUndefined();
    // Derived meshes are already world-space, so they carry the identity transform.
    expect(derived!.position.toArray()).toEqual([0, 0, 0]);
    const box = derived!.geometry.boundingBox ?? (derived!.geometry.computeBoundingBox(), derived!.geometry.boundingBox);
    expect(box!.max.z).toBeCloseTo(5, 5);
  });

  it('omits a hidden extrude feature from the scene', () => {
    const sync = new SceneSync();
    sync.sync(documentOf([], [rectangleSketch('s1'), extrude('e1', 's1', { visible: false })]));
    expect(sync.objectFor('e1')).toBeUndefined();
    expect(sync.scene.children).toHaveLength(0);
  });

  it('rebuilds and disposes a derived mesh when the extrusion depth changes', () => {
    const sync = new SceneSync();
    sync.sync(documentOf([], [rectangleSketch('s1'), extrude('e1', 's1', { depth: 5 })]));
    const before = sync.objectFor('e1') as Mesh;
    const geometryBefore = before.geometry;
    const disposeSpy = vi.spyOn(geometryBefore, 'dispose');

    sync.sync(documentOf([], [rectangleSketch('s1'), extrude('e1', 's1', { depth: 9 })]));

    const after = sync.objectFor('e1') as Mesh;
    expect(after).toBe(before);
    expect(after.geometry).not.toBe(geometryBefore);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('rebuilds a derived mesh when the extrusion is reversed', () => {
    const sync = new SceneSync();
    sync.sync(documentOf([], [rectangleSketch('s1'), extrude('e1', 's1', { depth: 5 })]));
    const geometryBefore = (sync.objectFor('e1') as Mesh).geometry;

    sync.sync(documentOf([], [rectangleSketch('s1'), extrude('e1', 's1', { depth: 5, reverse: true })]));

    const after = sync.objectFor('e1') as Mesh;
    // A reversed sweep is different geometry, so the mesh is rebuilt (not reused).
    expect(after.geometry).not.toBe(geometryBefore);
    after.geometry.computeBoundingBox();
    expect(after.geometry.boundingBox!.min.z).toBeCloseTo(-5, 4);
    expect(after.geometry.boundingBox!.max.z).toBeCloseTo(0, 4);
  });

  it('reuses a derived mesh across re-syncs when the feature is unchanged', () => {
    const sync = new SceneSync();
    sync.sync(documentOf([], [rectangleSketch('s1'), extrude('e1', 's1')]));
    const geometryBefore = (sync.objectFor('e1') as Mesh).geometry;

    sync.sync(documentOf([], [rectangleSketch('s1'), extrude('e1', 's1')]));

    expect((sync.objectFor('e1') as Mesh).geometry).toBe(geometryBefore);
  });

  it('removes a derived mesh once its feature becomes broken, disposing its GPU resources', () => {
    const sync = new SceneSync();
    sync.sync(documentOf([], [rectangleSketch('s1'), extrude('e1', 's1')]));
    const mesh = sync.objectFor('e1') as Mesh;
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose');

    // Point the extrude at a sketch that no longer exists -> diagnostic, no body.
    sync.sync(documentOf([], [extrude('e1', 's1')]));

    expect(sync.objectFor('e1')).toBeUndefined();
    expect(geometryDispose).toHaveBeenCalledTimes(1);
  });

  it('reports the world bounds of visible primitive and derived bodies, and null when empty', () => {
    const sync = new SceneSync();
    expect(sync.worldBounds()).toBeNull();

    sync.sync(documentOf([entity('prim', BOX)], [rectangleSketch('s1'), extrude('e1', 's1', { depth: 5 })]));
    const bounds = sync.worldBounds()!;
    // Box (10x20x30) spans x[-5,5], z[-15,15]; rectangle prism spans x[0,4], y[0,2], z[0,5].
    expect(bounds.min[0]).toBeCloseTo(-5, 5);
    expect(bounds.max[1]).toBeCloseTo(10, 5);
    expect(bounds.max[2]).toBeCloseTo(15, 5);
  });

  it('is a pure projection: two independent syncs of an equivalent document produce equal but distinct geometry', () => {
    const doc = documentOf([entity('a', BOX)]);
    const syncOne = new SceneSync();
    const syncTwo = new SceneSync();
    syncOne.sync(doc);
    syncTwo.sync(doc);

    const meshOne = syncOne.objectFor('a') as Mesh;
    const meshTwo = syncTwo.objectFor('a') as Mesh;

    expect(meshOne).not.toBe(meshTwo);
    expect(meshOne.geometry).not.toBe(meshTwo.geometry);
    expect(Array.from(meshOne.geometry.getAttribute('position').array)).toEqual(
      Array.from(meshTwo.geometry.getAttribute('position').array),
    );
  });
});
