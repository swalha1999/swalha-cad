import type { SketchConstraint, SketchEntity, SketchFeature } from '@swalha-cad/document';
import { reflectArcAcrossLine, reflectPointAcrossLine, type ArcGeometry } from '@swalha-cad/geometry';
import { distance, projectToCurve, resolveCurve, type Point } from './curves.js';
import { findExistingPointId, type SketchEdit } from './trim.js';

/**
 * Deterministic, side-effect-free Mirror for sketch points, lines, circles, and
 * circular arcs about a selected straight sketch line (the axis). Every referenced
 * point is reflected exactly once about the *infinite* axis, so points shared
 * among the mirrored sources stay shared in the mirror (one new point, not two);
 * circles keep their radius, arcs keep their sweep magnitude with reversed
 * orientation, and construction state is preserved. New ids are drawn from
 * `createId` in a fixed, selection-order-independent order (mirrored points by
 * ascending source-point id, then mirrored entities by ascending source-entity id,
 * then cloned constraints in document order) so a deterministic generator yields
 * deterministic output. The sources are never mutated: Mirror only appends the
 * reflected geometry and any safely-remappable constraints, producing one
 * `{entities, constraints}` result the store applies through a single history
 * command (undo/redo restores exact ids and geometry).
 *
 * The document constraint schema has no symmetry relationship, so Mirror does not
 * fabricate one — the mirrored geometry is independently editable. It does clone
 * the source constraints that survive reflection unchanged (coincidence, distance,
 * radius, angle-between-lines always; horizontal/vertical only when the axis is
 * itself horizontal or vertical), remapped onto the mirrored ids. Constraints that
 * reference geometry outside the mirror selection, or that reflection would not
 * preserve, are skipped and reported — never faked.
 */

/** Why a mirror request could not resolve (no mutation happens in these cases). */
export type MirrorRejectionReason =
  | 'no-sources'
  | 'axis-not-a-line'
  | 'zero-length-axis'
  | 'axis-is-source'
  | 'missing-source'
  | 'unsupported-source';

/** How near (mm) a click must be to a line for the Mirror tool to pick it as the axis. */
export const MIRROR_PICK_DISTANCE = 5;

/** Axis is treated as horizontal/vertical when its direction is within this of an axis (radians ≈ 0.0057°). */
const AXIS_ALIGN_TOLERANCE = 1e-4;

/** The live mirrored geometry rendered as a preview before confirmation (plane-local coordinates). */
export interface MirrorPreview {
  readonly points: readonly Point[];
  readonly lines: readonly (readonly [Point, Point])[];
  readonly circles: readonly { readonly center: Point; readonly radius: number }[];
  readonly arcs: readonly ArcGeometry[];
  readonly axis: readonly [Point, Point];
}

/** Everything {@link applyMirror} needs beyond the raw preview: the resolved sources, axis, and per-point reflections. */
export interface MirrorResolution {
  readonly sources: readonly SketchEntity[];
  readonly axisA: Point;
  readonly axisB: Point;
  /** All source point ids to reflect (directly-selected points plus every endpoint/center referenced by a source), ascending. */
  readonly sourcePointIds: readonly string[];
  readonly reflected: ReadonlyMap<string, Point>;
}

export type MirrorComputation =
  | { readonly ok: true; readonly preview: MirrorPreview; readonly resolution: MirrorResolution }
  | { readonly ok: false; readonly reason: MirrorRejectionReason; readonly message: string };

const MESSAGES: Record<MirrorRejectionReason, string> = {
  'no-sources': 'Select one or more points, lines, circles, or arcs to mirror.',
  'axis-not-a-line': 'The mirror axis must be a straight sketch line.',
  'zero-length-axis': 'The mirror axis line has zero length.',
  'axis-is-source': 'The mirror axis cannot also be one of the mirrored entities.',
  'missing-source': 'A selected entity no longer exists.',
  'unsupported-source': 'Mirror supports only points, lines, circles, and arcs.',
};

function reject(reason: MirrorRejectionReason): MirrorComputation {
  return { ok: false, reason, message: MESSAGES[reason] };
}

function pointCoords(sketch: SketchFeature): Map<string, Point> {
  const coords = new Map<string, Point>();
  for (const entity of sketch.entities) {
    if (entity.kind === 'point') coords.set(entity.id, [entity.x, entity.y]);
  }
  return coords;
}

/** The point ids a source entity reflects: itself (a point) or its referenced endpoints/center. */
function sourcePointRefs(entity: SketchEntity): string[] {
  if (entity.kind === 'point') return [entity.id];
  if (entity.kind === 'line') return [entity.startId, entity.endId];
  if (entity.kind === 'circle' || entity.kind === 'arc') return [entity.centerId];
  return [];
}

/**
 * Resolves the sources and axis into a committable mirror, or a typed rejection.
 * Pure — never mutates. Both {@link mirrorPreview} and {@link applyMirror} funnel
 * through this so preview and commit agree exactly.
 */
export function computeMirror(sketch: SketchFeature, sourceIds: readonly string[], axisId: string): MirrorComputation {
  const axisCurve = resolveCurve(sketch, axisId);
  const axisEntity = sketch.entities.find((entity) => entity.id === axisId);
  if (!axisEntity) return reject('axis-not-a-line');
  if (axisEntity.kind !== 'line' || !axisCurve || axisCurve.kind !== 'line') return reject('axis-not-a-line');
  if (distance(axisCurve.a, axisCurve.b) === 0) return reject('zero-length-axis');

  const uniqueIds = [...new Set(sourceIds)];
  if (uniqueIds.length === 0) return reject('no-sources');
  if (uniqueIds.includes(axisId)) return reject('axis-is-source');

  const sources: SketchEntity[] = [];
  for (const id of uniqueIds) {
    const entity = sketch.entities.find((candidate) => candidate.id === id);
    if (!entity) return reject('missing-source');
    if (entity.kind !== 'point' && entity.kind !== 'line' && entity.kind !== 'circle' && entity.kind !== 'arc') {
      return reject('unsupported-source');
    }
    sources.push(entity);
  }

  const coords = pointCoords(sketch);
  const pointIdSet = new Set<string>();
  for (const entity of sources) {
    for (const ref of sourcePointRefs(entity)) pointIdSet.add(ref);
  }
  const sourcePointIds = [...pointIdSet].sort();
  const reflected = new Map<string, Point>();
  for (const pid of sourcePointIds) {
    const coord = coords.get(pid);
    if (!coord) return reject('missing-source');
    const r = reflectPointAcrossLine(coord, axisCurve.a, axisCurve.b);
    if (!r) return reject('zero-length-axis');
    reflected.set(pid, r);
  }

  const previewPoints: Point[] = [];
  const previewLines: (readonly [Point, Point])[] = [];
  const previewCircles: { center: Point; radius: number }[] = [];
  const previewArcs: ArcGeometry[] = [];
  for (const entity of sources) {
    if (entity.kind === 'point') {
      previewPoints.push(reflected.get(entity.id)!);
    } else if (entity.kind === 'line') {
      previewLines.push([reflected.get(entity.startId)!, reflected.get(entity.endId)!]);
    } else if (entity.kind === 'circle') {
      previewCircles.push({ center: reflected.get(entity.centerId)!, radius: entity.radius });
    } else {
      const curve = resolveCurve(sketch, entity.id);
      if (curve && curve.kind === 'arc') {
        const m = reflectArcAcrossLine(curve.arc, axisCurve.a, axisCurve.b);
        if (m) previewArcs.push(m);
      }
    }
  }

  const preview: MirrorPreview = {
    points: previewPoints,
    lines: previewLines,
    circles: previewCircles,
    arcs: previewArcs,
    axis: [axisCurve.a, axisCurve.b],
  };
  return {
    ok: true,
    preview,
    resolution: { sources, axisA: axisCurve.a, axisB: axisCurve.b, sourcePointIds, reflected },
  };
}

/** Previews the mirror for the given sources and axis, or a diagnostic; pure and non-mutating. */
export function mirrorPreview(sketch: SketchFeature, sourceIds: readonly string[], axisId: string): MirrorComputation {
  return computeMirror(sketch, sourceIds, axisId);
}

/** A materialised mirror edit plus the number of source constraints that could not be safely cloned. */
export interface MirrorEdit extends SketchEdit {
  /** New ids of the mirrored line/circle/arc/point entities, so the caller can select them. */
  readonly createdEntityIds: readonly string[];
  /** How many source constraints were skipped (reference external geometry, or reflection would not preserve them). */
  readonly skippedConstraintCount: number;
}

/** True when the axis line is horizontal or vertical, so horizontal/vertical constraints survive reflection unchanged. */
function axisIsOrthogonal(axisA: Point, axisB: Point): boolean {
  const dx = Math.abs(axisB[0] - axisA[0]);
  const dy = Math.abs(axisB[1] - axisA[1]);
  const len = Math.hypot(dx, dy);
  if (len === 0) return false;
  return dy / len <= AXIS_ALIGN_TOLERANCE || dx / len <= AXIS_ALIGN_TOLERANCE;
}

/**
 * Materialises a resolved mirror into new entity/constraint arrays appended to the
 * sketch. New ids come from `createId` in a fixed order — mirrored points (by
 * ascending source-point id), then mirrored entities (by ascending source-entity
 * id), then cloned constraints (document order) — so a deterministic id generator
 * yields deterministic output regardless of the order the user selected the
 * sources. Sources are never touched.
 */
export function applyMirror(sketch: SketchFeature, resolution: MirrorResolution, createId: () => string): MirrorEdit {
  const { sources, axisA, axisB, sourcePointIds, reflected } = resolution;
  const pointEntity = new Map<string, Extract<SketchEntity, { kind: 'point' }>>();
  for (const entity of sketch.entities) {
    if (entity.kind === 'point') pointEntity.set(entity.id, entity);
  }

  // 1. One mirrored point per source point id, in ascending id order (shared source points
  //    stay shared in the mirror). A reflected point that lands exactly on an existing point —
  //    e.g. a source point that lies on the axis reflects onto itself — reuses that point id
  //    rather than duplicating it, so a half-profile mirrored across a touching axis closes into
  //    one watertight loop. This references (never mutates) the existing point.
  const mirroredPointId = new Map<string, string>();
  const newPoints: SketchEntity[] = [];
  for (const pid of sourcePointIds) {
    const coord = reflected.get(pid)!;
    const existing = findExistingPointId(sketch, coord);
    if (existing) {
      mirroredPointId.set(pid, existing);
      continue;
    }
    const id = createId();
    mirroredPointId.set(pid, id);
    const source = pointEntity.get(pid);
    newPoints.push({ id, kind: 'point', x: coord[0], y: coord[1], construction: source?.construction ?? false });
  }

  // 2. One mirrored line/circle/arc per non-point source, in ascending id order.
  const mirroredEntityId = new Map<string, string>();
  const newEntities: SketchEntity[] = [];
  const nonPointSources = sources
    .filter((entity) => entity.kind !== 'point')
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const entity of nonPointSources) {
    const id = createId();
    mirroredEntityId.set(entity.id, id);
    if (entity.kind === 'line') {
      newEntities.push({
        id,
        kind: 'line',
        startId: mirroredPointId.get(entity.startId)!,
        endId: mirroredPointId.get(entity.endId)!,
        construction: entity.construction,
      });
    } else if (entity.kind === 'circle') {
      newEntities.push({
        id,
        kind: 'circle',
        centerId: mirroredPointId.get(entity.centerId)!,
        radius: entity.radius,
        construction: entity.construction,
      });
    } else if (entity.kind === 'arc') {
      const curve = resolveCurve(sketch, entity.id);
      const m = curve && curve.kind === 'arc' ? reflectArcAcrossLine(curve.arc, axisA, axisB) : null;
      if (m) {
        newEntities.push({
          id,
          kind: 'arc',
          centerId: mirroredPointId.get(entity.centerId)!,
          radius: m.radius,
          startAngle: m.startAngle,
          endAngle: m.endAngle,
          direction: m.direction,
          construction: entity.construction,
        });
      }
    }
  }

  // 3. Clone the source constraints reflection preserves, remapped onto the mirrored ids.
  const orthogonal = axisIsOrthogonal(axisA, axisB);
  const hasPoint = (id: string): boolean => mirroredPointId.has(id);
  const hasLineOrCircle = (id: string): boolean => mirroredEntityId.has(id);
  const clonedConstraints: SketchConstraint[] = [];
  let skippedConstraintCount = 0;

  const constraintRefs = (constraint: SketchConstraint): { points: string[]; entities: string[] } => {
    switch (constraint.kind) {
      case 'coincident':
      case 'distance':
        return { points: [constraint.pointA, constraint.pointB], entities: [] };
      case 'horizontal':
      case 'vertical':
        return { points: [], entities: [constraint.lineId] };
      case 'radius':
        return { points: [], entities: [constraint.circleId] };
      case 'angle':
        return { points: [], entities: [constraint.lineA, constraint.lineB] };
    }
  };

  for (const constraint of sketch.constraints) {
    const refs = constraintRefs(constraint);
    const referencesMirrored =
      refs.points.some(hasPoint) || refs.entities.some(hasLineOrCircle);
    if (!referencesMirrored) continue; // unrelated to the mirror selection — leave untouched, not "skipped".

    const allPointsMirrored = refs.points.every(hasPoint);
    const allEntitiesMirrored = refs.entities.every(hasLineOrCircle);
    if (!allPointsMirrored || !allEntitiesMirrored) {
      skippedConstraintCount++; // references geometry outside the mirror selection.
      continue;
    }

    switch (constraint.kind) {
      case 'coincident':
        clonedConstraints.push({
          id: createId(),
          kind: 'coincident',
          pointA: mirroredPointId.get(constraint.pointA)!,
          pointB: mirroredPointId.get(constraint.pointB)!,
        });
        break;
      case 'distance':
        clonedConstraints.push({
          id: createId(),
          kind: 'distance',
          pointA: mirroredPointId.get(constraint.pointA)!,
          pointB: mirroredPointId.get(constraint.pointB)!,
          value: constraint.value,
        });
        break;
      case 'radius':
        clonedConstraints.push({
          id: createId(),
          kind: 'radius',
          circleId: mirroredEntityId.get(constraint.circleId)!,
          value: constraint.value,
        });
        break;
      case 'angle':
        clonedConstraints.push({
          id: createId(),
          kind: 'angle',
          lineA: mirroredEntityId.get(constraint.lineA)!,
          lineB: mirroredEntityId.get(constraint.lineB)!,
          valueDeg: constraint.valueDeg,
        });
        break;
      case 'horizontal':
      case 'vertical':
        if (orthogonal) {
          clonedConstraints.push({ id: createId(), kind: constraint.kind, lineId: mirroredEntityId.get(constraint.lineId)! });
        } else {
          skippedConstraintCount++; // an angled axis turns a horizontal/vertical line into an angled one.
        }
        break;
    }
  }

  const entities = [...sketch.entities, ...newPoints, ...newEntities];
  const constraints = [...sketch.constraints, ...clonedConstraints];
  const createdEntityIds = [...newPoints.map((p) => p.id), ...newEntities.map((e) => e.id)];
  return { entities, constraints, createdEntityIds, skippedConstraintCount };
}

/** The nearest straight line id to `point` within `maxDistance`, ties broken by id; `null` when none is close enough. Used to pick the axis. */
export function pickMirrorAxis(sketch: SketchFeature, point: Point, maxDistance = MIRROR_PICK_DISTANCE): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const entity of sketch.entities) {
    if (entity.kind !== 'line') continue;
    const curve = resolveCurve(sketch, entity.id);
    if (!curve || curve.kind !== 'line') continue;
    const d = projectToCurve(curve, point).distance;
    if (d > maxDistance) continue;
    if (best === null || d < best.distance || (d === best.distance && entity.id < best.id)) {
      best = { id: entity.id, distance: d };
    }
  }
  return best ? best.id : null;
}
