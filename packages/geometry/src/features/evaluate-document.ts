import type { CadDocumentV2, ExtrudeFeature, Primitive, SketchFeature, Transform } from '@swalha-cad/document';
import { buildPrimitiveMesh } from '../build-primitive-mesh.js';
import { transformPointBy } from '../math/transform.js';
import type { Vec3 } from '../math/vec3.js';
import type { IndexedMesh } from '../mesh.js';
import { getPosition, vertexCount } from '../mesh.js';
import type { MeshBounds } from '../mesh-validation.js';
import type { TopologyIssue } from '../sketch/topology.js';
import { extrudeSketch } from './extrude.js';

/**
 * Geometry backing a renderable/exportable body. A `primitive` body carries an
 * M1 primitive plus its model→world transform (baked lazily by consumers); a
 * `mesh` body carries an already-world-space indexed mesh derived from a
 * feature, whose transform is therefore the identity.
 */
export type EvaluatedBodyGeometry =
  | { readonly kind: 'primitive'; readonly primitive: Primitive; readonly transform: Transform }
  | { readonly kind: 'mesh'; readonly mesh: IndexedMesh };

/**
 * One solid a renderer or exporter can consume, keyed by the document id it
 * derives from (an entity id for primitives, a feature id for derived solids).
 * `buildKey` is a stable content identity: it changes when — and only when —
 * the geometry itself must be rebuilt, so a cache can reuse GPU resources
 * across evaluations whose geometry is unchanged (a moved primitive keeps its
 * key; an edited sketch or depth does not).
 */
export interface EvaluatedBody {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly buildKey: string;
  readonly geometry: EvaluatedBodyGeometry;
}

export type EvaluationDiagnosticCode = 'missing-sketch' | 'invalid-profile' | 'degenerate-profile' | 'invalid-depth';

/** A structured reason a feature produced no body, replacing any stale geometry it previously had. */
export interface EvaluationDiagnostic {
  readonly featureId: string;
  readonly featureName: string;
  readonly code: EvaluationDiagnosticCode;
  readonly message: string;
  readonly issues: readonly TopologyIssue[];
}

export interface EvaluatedDocument {
  readonly bodies: readonly EvaluatedBody[];
  readonly diagnostics: readonly EvaluationDiagnostic[];
}

function primitiveBody(id: string, name: string, visible: boolean, primitive: Primitive, transform: Transform): EvaluatedBody {
  return {
    id,
    name,
    visible,
    // Transform is applied by consumers, not baked into the geometry, so it is
    // deliberately excluded from the key: a moved primitive reuses its mesh.
    buildKey: `primitive:${JSON.stringify(primitive)}`,
    geometry: { kind: 'primitive', primitive, transform },
  };
}

function extrudeBody(feature: ExtrudeFeature, sketch: SketchFeature, mesh: IndexedMesh): EvaluatedBody {
  return {
    id: feature.id,
    name: feature.name,
    visible: true,
    // Everything the derived mesh depends on: the plane and geometry of the
    // resolved sketch plus this feature's sweep. Constraints are not included —
    // the solver has already baked its result into the stored point coordinates.
    buildKey: `extrude:${JSON.stringify({
      plane: sketch.plane,
      entities: sketch.entities,
      depth: feature.depth,
      direction: feature.direction,
    })}`,
    geometry: { kind: 'mesh', mesh },
  };
}

function diagnostic(
  feature: ExtrudeFeature,
  code: EvaluationDiagnosticCode,
  message: string,
  issues: readonly TopologyIssue[] = [],
): EvaluationDiagnostic {
  return { featureId: feature.id, featureName: feature.name, code, message, issues };
}

/**
 * Evaluates a `CadDocumentV2` into the ordered set of solid bodies a renderer
 * and STL exporter consume, plus structured diagnostics for any feature that
 * could not be built.
 *
 * The document stays the sole source of truth; this is a pure, deterministic
 * projection. M1 primitive entities are retained verbatim as bodies (in
 * document order, first), then features are processed in document order:
 *
 * - Sketch features are non-solid and never become bodies, whatever their
 *   visibility.
 * - A hidden extrude feature is omitted entirely — no body, no diagnostic.
 * - A visible extrude resolves its `sketchId` against the sketch features. A
 *   missing reference, a reference to a non-sketch feature, or an invalid /
 *   degenerate / open profile yields a diagnostic and no body, so a broken
 *   feature never renders or exports stale geometry. The source sketch's own
 *   visibility does not matter: a hidden sketch may still drive a visible
 *   extrude.
 *
 * Re-evaluating after editing a sketch's geometry or an extrude's depth
 * changes the affected body's `buildKey` and rebuilds its mesh, while an
 * unrelated edit (a moved primitive, a renamed feature) leaves keys intact.
 */
export function evaluateDocument(document: CadDocumentV2): EvaluatedDocument {
  const bodies: EvaluatedBody[] = [];
  const diagnostics: EvaluationDiagnostic[] = [];

  for (const entity of document.entities) {
    bodies.push(primitiveBody(entity.id, entity.name, entity.visible, entity.primitive, entity.transform));
  }

  const sketches = new Map<string, SketchFeature>();
  for (const feature of document.features) {
    if (feature.kind === 'sketch') sketches.set(feature.id, feature);
  }

  for (const feature of document.features) {
    if (feature.kind !== 'extrude') continue;
    if (!feature.visible) continue;

    const sketch = sketches.get(feature.sketchId);
    if (!sketch) {
      diagnostics.push(
        diagnostic(feature, 'missing-sketch', `Extrude "${feature.name}" references unknown sketch ${feature.sketchId}.`),
      );
      continue;
    }

    const result = extrudeSketch(sketch, { depth: feature.depth, direction: feature.direction });
    if (!result.ok) {
      diagnostics.push(diagnostic(feature, result.error.code, result.error.message, result.error.issues));
      continue;
    }

    bodies.push(extrudeBody(feature, sketch, result.mesh));
  }

  return { bodies, diagnostics };
}

function worldVertex(body: EvaluatedBody, mesh: IndexedMesh, vertexIndex: number): Vec3 {
  const position = getPosition(mesh, vertexIndex);
  return body.geometry.kind === 'primitive' ? transformPointBy(body.geometry.transform, position) : position;
}

/** The mesh a body renders/exports: primitives are tessellated on demand, derived solids are used as-is. */
function bodyMesh(body: EvaluatedBody): IndexedMesh {
  return body.geometry.kind === 'primitive' ? buildPrimitiveMesh(body.geometry.primitive) : body.geometry.mesh;
}

/**
 * Axis-aligned world-space bounding box of every visible body in an evaluated
 * document, or `null` when nothing visible has geometry. Useful for framing a
 * camera on the whole model regardless of whether each body is an M1 primitive
 * (bounds after its transform) or a derived solid (already world-space).
 */
export function evaluatedWorldBounds(evaluated: EvaluatedDocument): MeshBounds | null {
  let min: Vec3 = [Infinity, Infinity, Infinity];
  let max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let found = false;

  for (const body of evaluated.bodies) {
    if (!body.visible) continue;
    const mesh = bodyMesh(body);
    for (let v = 0; v < vertexCount(mesh); v++) {
      const [x, y, z] = worldVertex(body, mesh, v);
      min = [Math.min(min[0], x), Math.min(min[1], y), Math.min(min[2], z)];
      max = [Math.max(max[0], x), Math.max(max[1], y), Math.max(max[2], z)];
      found = true;
    }
  }

  return found ? { min, max } : null;
}
