import type { CadDocumentV2, CadEntity, Primitive, Transform } from '@swalha-cad/document';
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

function documentOf(entities: CadEntity[]): CadDocumentV2 {
  return { schemaVersion: 2, units: 'mm', entities, features: [] };
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
