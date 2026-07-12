import type { SketchConstraint, SketchEntity, SketchFeature } from '@swalha-cad/document';
import { filletTwoLines, type ArcGeometry, type FilletRejection, type FilletSolution } from '@swalha-cad/geometry';
import { resolveCurve, projectToCurve, type Point, type ResolvedCurve } from './curves.js';
import { constraintPointRefs, findExistingPointId, referencedPointIds, type SketchEdit } from './trim.js';

/**
 * Deterministic, side-effect-free Fillet for two intersecting or endpoint-connected
 * straight sketch lines. Each pick names a line and the plane-local point the user
 * clicked on it; the point selects which ray of the corner (the intersection of the
 * two infinite lines) is kept. The pure {@link filletTwoLines} kernel computes the
 * single tangent arc; this module resolves that against the concrete sketch —
 * trimming or extending each line back to its tangent point, materialising one
 * first-class circular arc with an exact centre point, dropping the corner point
 * when it is orphaned, and remapping constraints (horizontal/vertical survive on
 * the preserved line ids; coincident/distance on a vanished corner point are
 * removed and reported). Nothing mutates until {@link applyFillet}; every degenerate
 * configuration (parallel, zero/straight angle, invalid or oversized radius,
 * ambiguous pick, mismatched construction state, or a non-line/duplicate pick) is
 * refused with a caller-facing diagnostic. The whole edit is one `{entities,
 * constraints}` result the store applies through a single history command, so
 * undo/redo restores exact ids, geometry, and constraints.
 */

/** A line the user picked for the fillet, plus the plane-local point selecting the retained side. */
export interface FilletPick {
  readonly lineId: string;
  readonly point: Point;
}

/** Why a fillet request could not resolve (kernel reasons plus this module's entity-level ones). */
export type FilletRejectionReason =
  | FilletRejection
  | 'missing-line'
  | 'not-a-line'
  | 'same-line'
  | 'construction-mismatch';

/** The hover/awaiting preview a fillet renders before it is committed. */
export interface FilletPreview {
  readonly arc: ArcGeometry;
  readonly tangentA: Point;
  readonly tangentB: Point;
  /** Line A's remaining portion after the fillet: retained far endpoint → tangent point. */
  readonly trimmedA: readonly [Point, Point];
  readonly trimmedB: readonly [Point, Point];
  readonly corner: Point;
}

export type FilletComputation =
  | { readonly ok: true; readonly preview: FilletPreview; readonly resolution: FilletResolution }
  | { readonly ok: false; readonly reason: FilletRejectionReason; readonly message: string };

const MESSAGES: Record<FilletRejectionReason, string> = {
  'radius-invalid': 'Enter a positive fillet radius.',
  parallel: 'These lines are parallel — there is no corner to fillet.',
  'zero-angle': 'These lines meet at too shallow an angle to fillet.',
  'straight-angle': 'These lines are nearly straight — there is no corner to fillet.',
  'radius-too-large': 'Radius is too large to fit these line segments.',
  ambiguous: 'Pick each line away from the corner so a side can be chosen.',
  degenerate: 'These lines cannot be filleted.',
  'missing-line': 'Select two lines to fillet.',
  'not-a-line': 'Fillet works only between two straight lines.',
  'same-line': 'Select two different lines.',
  'construction-mismatch': 'Both lines must share the same construction state.',
};

function reject(reason: FilletRejectionReason): FilletComputation {
  return { ok: false, reason, message: MESSAGES[reason] };
}

/** A resolved line ready for the fillet: its entity, the retained far point, the corner point, and its tangent. */
interface ResolvedFilletLine {
  readonly line: Extract<SketchEntity, { kind: 'line' }>;
  readonly retainedPointId: string;
  readonly retainedCoord: Point;
  readonly cornerPointId: string;
  readonly tangent: Point;
}

/** Everything {@link applyFillet} needs beyond the raw kernel solution. */
export interface FilletResolution {
  readonly solution: FilletSolution;
  readonly a: ResolvedFilletLine;
  readonly b: ResolvedFilletLine;
  readonly construction: boolean;
}

function lineEntity(sketch: SketchFeature, id: string): Extract<SketchEntity, { kind: 'line' }> | null {
  const entity = sketch.entities.find((candidate) => candidate.id === id);
  return entity && entity.kind === 'line' ? entity : null;
}

function resolveLine(
  line: Extract<SketchEntity, { kind: 'line' }>,
  curve: Extract<ResolvedCurve, { kind: 'line' }>,
  retained: 'a' | 'b',
  tangent: Point,
): ResolvedFilletLine {
  const retainedPointId = retained === 'a' ? line.startId : line.endId;
  const cornerPointId = retained === 'a' ? line.endId : line.startId;
  const retainedCoord = retained === 'a' ? curve.a : curve.b;
  return { line, retainedPointId, retainedCoord, cornerPointId, tangent };
}

/**
 * Resolves the two picks and radius into a committable fillet, or a typed
 * rejection. Pure — never mutates. Both {@link filletPreview} and
 * {@link applyFillet} funnel through this so preview and commit agree exactly.
 */
export function computeFillet(sketch: SketchFeature, pickA: FilletPick, pickB: FilletPick, radius: number): FilletComputation {
  if (pickA.lineId === pickB.lineId) return reject('same-line');
  const entityA = lineEntity(sketch, pickA.lineId);
  const entityB = lineEntity(sketch, pickB.lineId);
  if (!entityA || !entityB) {
    // Distinguish a missing entity from a non-line pick for a clearer message.
    const rawA = sketch.entities.find((e) => e.id === pickA.lineId);
    const rawB = sketch.entities.find((e) => e.id === pickB.lineId);
    if (!rawA || !rawB) return reject('missing-line');
    return reject('not-a-line');
  }
  if (entityA.construction !== entityB.construction) return reject('construction-mismatch');

  const curveA = resolveCurve(sketch, entityA.id);
  const curveB = resolveCurve(sketch, entityB.id);
  if (!curveA || curveA.kind !== 'line' || !curveB || curveB.kind !== 'line') return reject('missing-line');

  const result = filletTwoLines(
    { a: curveA.a, b: curveA.b, pick: pickA.point },
    { a: curveB.a, b: curveB.b, pick: pickB.point },
    radius,
  );
  if (!result.ok) return reject(result.reason);

  const solution = result.solution;
  const a = resolveLine(entityA, curveA, solution.retainedA, solution.tangentA);
  const b = resolveLine(entityB, curveB, solution.retainedB, solution.tangentB);
  const preview: FilletPreview = {
    arc: solution.arc,
    tangentA: solution.tangentA,
    tangentB: solution.tangentB,
    trimmedA: [a.retainedCoord, solution.tangentA],
    trimmedB: [b.retainedCoord, solution.tangentB],
    corner: solution.corner,
  };
  return { ok: true, preview, resolution: { solution, a, b, construction: entityA.construction } };
}

/** Previews the fillet for the given picks and radius, or a diagnostic; pure and non-mutating. */
export function filletPreview(sketch: SketchFeature, pickA: FilletPick, pickB: FilletPick, radius: number): FilletComputation {
  return computeFillet(sketch, pickA, pickB, radius);
}

/** A materialised fillet edit plus the ids of constraints it had to remove (invalidated by the trimmed corner). */
export interface FilletEdit extends SketchEdit {
  readonly removedConstraintIds: readonly string[];
}

/**
 * Materialises a resolved fillet into new entity/constraint arrays. New ids are
 * drawn from `createId` in a fixed order — tangent point A, tangent point B, arc
 * centre point, then the arc entity — so a deterministic generator yields
 * deterministic output. The two lines keep their original ids (only their
 * corner-side endpoint is rewritten to the tangent point), horizontal/vertical
 * constraints survive on them, and a corner point left unreferenced is dropped
 * along with any coincident/distance constraint that named it.
 */
export function applyFillet(sketch: SketchFeature, resolution: FilletResolution, createId: () => string): FilletEdit {
  const { solution, a, b, construction } = resolution;

  const tangentAId = tangentPointId(sketch, a.tangent, createId);
  const tangentBId = tangentPointId(sketch, b.tangent, createId);
  const centerId = createId();
  const arcId = createId();

  const newPoints: SketchEntity[] = [];
  if (tangentAId.created) newPoints.push({ id: tangentAId.id, kind: 'point', x: a.tangent[0], y: a.tangent[1], construction });
  if (tangentBId.created) newPoints.push({ id: tangentBId.id, kind: 'point', x: b.tangent[0], y: b.tangent[1], construction });
  newPoints.push({ id: centerId, kind: 'point', x: solution.arc.center[0], y: solution.arc.center[1], construction });

  const newLineA = rewriteLine(a.line, a.cornerPointId, tangentAId.id);
  const newLineB = rewriteLine(b.line, b.cornerPointId, tangentBId.id);
  const arc: SketchEntity = {
    id: arcId,
    kind: 'arc',
    centerId,
    radius: solution.arc.radius,
    startAngle: solution.arc.startAngle,
    endAngle: solution.arc.endAngle,
    direction: solution.arc.direction,
    construction,
  };

  let entities: SketchEntity[] = sketch.entities.filter((entity) => entity.id !== a.line.id && entity.id !== b.line.id);
  entities = [...entities, ...newPoints, newLineA, newLineB, arc];

  // Drop each corner-side endpoint only if nothing references it any more (never a shared corner still in use).
  const referenced = referencedPointIds(entities);
  const removedPointIds = new Set<string>();
  for (const cornerPointId of new Set([a.cornerPointId, b.cornerPointId])) {
    if (!referenced.has(cornerPointId)) {
      entities = entities.filter((entity) => entity.id !== cornerPointId);
      removedPointIds.add(cornerPointId);
    }
  }

  const kept: SketchConstraint[] = [];
  const removedConstraintIds: string[] = [];
  for (const constraint of sketch.constraints) {
    if (constraintPointRefs(constraint).some((ref) => removedPointIds.has(ref))) {
      removedConstraintIds.push(constraint.id);
      continue;
    }
    kept.push(constraint);
  }

  return { entities, constraints: kept, removedConstraintIds };
}

/** How near (mm) a click must be to a line for the Fillet tool to pick it. */
export const FILLET_PICK_DISTANCE = 5;

/** A sensible starting radius, halved until it fits the picked segments. */
const DEFAULT_FILLET_RADIUS = 5;

/** The nearest straight line to `point` within `maxDistance`, as a {@link FilletPick} carrying the raw click point; `null` when none is close enough. */
export function pickFilletLine(sketch: SketchFeature, point: Point, maxDistance = FILLET_PICK_DISTANCE): FilletPick | null {
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
  return best ? { lineId: best.id, point } : null;
}

/** A {@link FilletPick} at a line's midpoint, for the selection-first flow (no explicit click point). */
export function lineMidpointPick(sketch: SketchFeature, lineId: string): FilletPick | null {
  const curve = resolveCurve(sketch, lineId);
  if (!curve || curve.kind !== 'line') return null;
  return { lineId, point: [(curve.a[0] + curve.b[0]) / 2, (curve.a[1] + curve.b[1]) / 2] };
}

/** A fitting default radius for two picked lines: 5 mm, halved until the fillet fits the bounded segments. */
export function suggestFilletRadius(sketch: SketchFeature, a: FilletPick, b: FilletPick): number {
  let radius = DEFAULT_FILLET_RADIUS;
  for (let i = 0; i < 48; i++) {
    const result = computeFillet(sketch, a, b, radius);
    if (result.ok) return radius;
    if (result.reason !== 'radius-too-large') return DEFAULT_FILLET_RADIUS;
    radius /= 2;
  }
  return radius;
}

/** Reuses an existing coincident point for the tangent (rare) or allocates a fresh one. */
function tangentPointId(sketch: SketchFeature, coord: Point, createId: () => string): { id: string; created: boolean } {
  const existing = findExistingPointId(sketch, coord);
  if (existing) return { id: existing, created: false };
  return { id: createId(), created: true };
}

/** Rewrites a line so its corner-side endpoint becomes the tangent point, preserving endpoint order. */
function rewriteLine(line: Extract<SketchEntity, { kind: 'line' }>, cornerPointId: string, tangentId: string): SketchEntity {
  return {
    id: line.id,
    kind: 'line',
    startId: line.startId === cornerPointId ? tangentId : line.startId,
    endId: line.endId === cornerPointId ? tangentId : line.endId,
    construction: line.construction,
  };
}
