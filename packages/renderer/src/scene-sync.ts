import type { CadDocumentV2, CadEntity, Primitive, Transform } from '@swalha-cad/document';
import { buildPrimitiveMesh } from '@swalha-cad/geometry';
import type { Material } from 'three';
import { FrontSide, MathUtils, Mesh, MeshStandardMaterial, Scene } from 'three';
import { createBufferGeometry } from './mesh-adapter.js';

interface SyncedEntity {
  readonly object: Mesh;
  readonly primitiveKey: string;
}

/** New materials are created with depth testing and back-face culling explicit, not left to Three.js defaults. */
function createEntityMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: 0xaab4c2, roughness: 0.45, metalness: 0.12 });
  material.depthTest = true;
  material.side = FrontSide;
  return material;
}

function disposeMaterial(material: Material | Material[]): void {
  if (Array.isArray(material)) {
    for (const m of material) m.dispose();
  } else {
    material.dispose();
  }
}

function disposeSyncedEntity(synced: SyncedEntity): void {
  synced.object.geometry.dispose();
  disposeMaterial(synced.object.material);
}

/**
 * Model matrix: translate * rotate(X,Y,Z) * scale, matching
 * `composeTransformMatrix` in the geometry package, which rotates about the
 * local X axis first, then Y, then Z (`Rz * Ry * Rx` applied to a point).
 * Three's Euler order string denotes matrix composition left to right, so
 * that composition is Three's `'ZYX'` order, not the `'XYZ'` default.
 */
function applyModelTransform(object: Mesh, transform: Transform): void {
  const [tx, ty, tz] = transform.translation;
  object.position.set(tx, ty, tz);
  const [rx, ry, rz] = transform.rotationDeg;
  object.rotation.set(MathUtils.degToRad(rx), MathUtils.degToRad(ry), MathUtils.degToRad(rz), 'ZYX');
  const [sx, sy, sz] = transform.scale;
  object.scale.set(sx, sy, sz);
}

function primitiveKeyOf(primitive: Primitive): string {
  return JSON.stringify(primitive);
}

/**
 * Projects a `CadDocumentV2` into a Three.js `Scene` without the document
 * ever depending on Three.js: the document stays the sole source of truth,
 * and this class only maintains a disposable rendering cache, keyed by
 * entity id, that `sync` rebuilds to match whatever document it is given.
 * Geometries and materials survive a `sync` call unchanged when an entity's
 * primitive is unchanged; they are replaced (and the old GPU resources
 * disposed) when the primitive changes, and removed/disposed when the
 * entity disappears from the document.
 */
export class SceneSync {
  readonly scene: Scene;
  private readonly synced = new Map<string, SyncedEntity>();

  constructor(scene: Scene = new Scene()) {
    this.scene = scene;
  }

  objectFor(entityId: string): Mesh | undefined {
    return this.synced.get(entityId)?.object;
  }

  sync(document: CadDocumentV2): void {
    const seenIds = new Set<string>();
    for (const entity of document.entities) {
      seenIds.add(entity.id);
      this.syncEntity(entity);
    }
    for (const [id, synced] of this.synced) {
      if (seenIds.has(id)) continue;
      this.scene.remove(synced.object);
      disposeSyncedEntity(synced);
      this.synced.delete(id);
    }
  }

  private syncEntity(entity: CadEntity): void {
    const primitiveKey = primitiveKeyOf(entity.primitive);
    let synced = this.synced.get(entity.id);

    if (!synced) {
      const object = new Mesh(buildGeometryFor(entity.primitive), createEntityMaterial());
      this.scene.add(object);
      synced = { object, primitiveKey };
      this.synced.set(entity.id, synced);
    } else if (synced.primitiveKey !== primitiveKey) {
      const oldGeometry = synced.object.geometry;
      synced.object.geometry = buildGeometryFor(entity.primitive);
      oldGeometry.dispose();
      synced = { object: synced.object, primitiveKey };
      this.synced.set(entity.id, synced);
    }

    synced.object.name = entity.name;
    synced.object.visible = entity.visible;
    applyModelTransform(synced.object, entity.transform);
  }

  /** Releases every synced GPU resource and empties the scene; the SceneSync itself may be reused afterwards. */
  dispose(): void {
    for (const synced of this.synced.values()) {
      this.scene.remove(synced.object);
      disposeSyncedEntity(synced);
    }
    this.synced.clear();
  }
}

function buildGeometryFor(primitive: Primitive) {
  return createBufferGeometry(buildPrimitiveMesh(primitive));
}
