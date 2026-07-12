import type { CadDocumentV2, Transform } from '@swalha-cad/document';
import type { EvaluatedBody, EvaluatedFace, MeshBounds } from '@swalha-cad/geometry';
import { buildPrimitiveMesh, evaluateDocument, evaluatedWorldBounds } from '@swalha-cad/geometry';
import type { BufferGeometry, Material } from 'three';
import { FrontSide, MathUtils, Mesh, MeshStandardMaterial, Scene } from 'three';
import { createBufferGeometry } from './mesh-adapter.js';

interface SyncedBody {
  readonly object: Mesh;
  readonly buildKey: string;
  readonly faces: readonly EvaluatedFace[];
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

function disposeSyncedBody(synced: SyncedBody): void {
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

/** Derived solids are already world-space, so a mesh body renders under the identity transform. */
function applyIdentityTransform(object: Mesh): void {
  object.position.set(0, 0, 0);
  object.rotation.set(0, 0, 0);
  object.scale.set(1, 1, 1);
}

function buildGeometryForBody(body: EvaluatedBody): BufferGeometry {
  if (body.geometry.kind === 'primitive') {
    return createBufferGeometry(buildPrimitiveMesh(body.geometry.primitive));
  }
  return createBufferGeometry(body.geometry.mesh);
}

/**
 * Projects a `CadDocumentV2` into a Three.js `Scene` without the document ever
 * depending on Three.js: the document stays the sole source of truth, and this
 * class only maintains a disposable rendering cache, keyed by body id, that
 * `sync` rebuilds to match whatever document it is given.
 *
 * Every `sync` evaluates the document (via the geometry package) into ordered
 * bodies — retained M1 primitives plus derived solids for valid visible
 * extrude features — and reconciles the cache against them. A body's geometry
 * and material survive a `sync` unchanged when its `buildKey` is unchanged;
 * they are replaced (and the old GPU resources disposed) when the geometry
 * changes, and removed/disposed when the body disappears (a deleted entity, a
 * hidden or newly-broken extrude). Standalone sketches are non-solid and never
 * produce an object.
 */
export class SceneSync {
  readonly scene: Scene;
  private readonly synced = new Map<string, SyncedBody>();
  private lastBounds: MeshBounds | null = null;

  constructor(scene: Scene = new Scene()) {
    this.scene = scene;
  }

  objectFor(bodyId: string): Mesh | undefined {
    return this.synced.get(bodyId)?.object;
  }

  /** Semantic face provenance of a synced body's mesh (empty for bodies without faces), for face picking/highlighting. */
  facesFor(bodyId: string): readonly EvaluatedFace[] {
    return this.synced.get(bodyId)?.faces ?? [];
  }

  /** World-space bounds of the last synced document's visible bodies, or `null` when nothing visible was drawn. */
  worldBounds(): MeshBounds | null {
    return this.lastBounds;
  }

  sync(document: CadDocumentV2): void {
    const evaluated = evaluateDocument(document);
    const seenIds = new Set<string>();
    for (const body of evaluated.bodies) {
      seenIds.add(body.id);
      this.syncBody(body);
    }
    for (const [id, synced] of this.synced) {
      if (seenIds.has(id)) continue;
      this.scene.remove(synced.object);
      disposeSyncedBody(synced);
      this.synced.delete(id);
    }
    this.lastBounds = evaluatedWorldBounds(evaluated);
  }

  private syncBody(body: EvaluatedBody): void {
    let synced = this.synced.get(body.id);

    if (!synced) {
      const object = new Mesh(buildGeometryForBody(body), createEntityMaterial());
      this.scene.add(object);
      synced = { object, buildKey: body.buildKey, faces: body.faces };
      this.synced.set(body.id, synced);
    } else if (synced.buildKey !== body.buildKey) {
      const oldGeometry = synced.object.geometry;
      synced.object.geometry = buildGeometryForBody(body);
      oldGeometry.dispose();
      synced = { object: synced.object, buildKey: body.buildKey, faces: body.faces };
      this.synced.set(body.id, synced);
    } else if (synced.faces !== body.faces) {
      // Geometry unchanged but faces recomputed (a fresh evaluation): refresh the provenance.
      synced = { object: synced.object, buildKey: synced.buildKey, faces: body.faces };
      this.synced.set(body.id, synced);
    }

    synced.object.name = body.name;
    synced.object.visible = body.visible;
    if (body.geometry.kind === 'primitive') {
      applyModelTransform(synced.object, body.geometry.transform);
    } else {
      applyIdentityTransform(synced.object);
    }
  }

  /** Releases every synced GPU resource and empties the scene; the SceneSync itself may be reused afterwards. */
  dispose(): void {
    for (const synced of this.synced.values()) {
      this.scene.remove(synced.object);
      disposeSyncedBody(synced);
    }
    this.synced.clear();
    this.lastBounds = null;
  }
}
