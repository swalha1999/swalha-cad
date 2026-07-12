import { z } from 'zod';
import type {
  CadCommand,
  CadDocumentV2,
  CadFeature,
  SketchConstraint,
  SketchEntity,
  SketchFeature,
} from '@swalha-cad/document';
import { applyCommand, parseCadDocument } from '@swalha-cad/document';
import type { ArcDirection, SolveDiagnostic, SolveStatus, Vec2 } from '@swalha-cad/geometry';
import { solveSketch } from '@swalha-cad/geometry';

/** The three origin planes a sketch can be created on. */
export const sketchPlaneSchema = z.enum(['XY', 'XZ', 'YZ']);

/**
 * A reference to a sketch point: either an existing point by id, or a pair of
 * plane-local millimetre coordinates for a point that will be created (and
 * merged with any coincident existing/earlier point, matching the browser's
 * sketch commit behaviour).
 */
export const pointRefSchema = z.union([
  z.object({ pointId: z.string().min(1) }).strict(),
  z.object({ x: z.number(), y: z.number() }).strict(),
]);
export type PointRefInput = z.infer<typeof pointRefSchema>;

/** A concrete plane-local coordinate pair (used by the compound-shape math). */
export const coordinateSchema = z.object({ x: z.number(), y: z.number() }).strict();
export type CoordinateInput = z.infer<typeof coordinateSchema>;

const COINCIDENT_EPSILON = 1e-6;

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= COINCIDENT_EPSILON;
}

/**
 * Appends a numeric suffix (`"Sketch 1"`, `"Sketch 2"`, ...) so each feature
 * name is unique, matching the browser store's `nextFeatureName`.
 */
export function nextFeatureName(features: readonly CadFeature[], base: string): string {
  const used = new Set(features.map((feature) => feature.name));
  let suffix = 1;
  while (used.has(`${base} ${suffix}`)) suffix++;
  return `${base} ${suffix}`;
}

/** The first point in a sketch, held fixed by the solver so a mobile sketch can become fully constrained. */
export function firstAnchorPointId(sketch: SketchFeature): string | null {
  for (const entity of sketch.entities) {
    if (entity.kind === 'point') return entity.id;
  }
  return null;
}

/** Locates a sketch feature by id, distinguishing "missing" from "not a sketch". */
export type SketchLookup =
  | { readonly ok: true; readonly sketch: SketchFeature }
  | { readonly ok: false; readonly code: 'feature_not_found' | 'not_a_sketch'; readonly message: string };

export function findSketch(document: CadDocumentV2, id: string): SketchLookup {
  const feature = document.features.find((candidate) => candidate.id === id);
  if (!feature) {
    return { ok: false, code: 'feature_not_found', message: `No feature with id "${id}".` };
  }
  if (feature.kind !== 'sketch') {
    return { ok: false, code: 'not_a_sketch', message: `Feature "${id}" is a ${feature.kind}, not a sketch.` };
  }
  return { ok: true, sketch: feature };
}

/** Resolves a point reference to concrete plane-local coordinates within a sketch. */
export type CoordResolution =
  | { readonly ok: true; readonly coords: Vec2 }
  | { readonly ok: false; readonly message: string };

export function resolvePointCoords(sketch: SketchFeature, ref: PointRefInput): CoordResolution {
  if ('pointId' in ref) {
    const point = sketch.entities.find((entity) => entity.id === ref.pointId);
    if (!point) return { ok: false, message: `No sketch entity with id "${ref.pointId}".` };
    if (point.kind !== 'point') return { ok: false, message: `Sketch entity "${ref.pointId}" is a ${point.kind}, not a point.` };
    return { ok: true, coords: [point.x, point.y] };
  }
  return { ok: true, coords: [ref.x, ref.y] };
}

/** A plane-local commit point: reuse an existing point by id, or place a new one by coordinate. */
export type CommitPoint = { readonly kind: 'existing'; readonly id: string } | { readonly kind: 'new'; readonly x: number; readonly y: number };

/** Turns a validated point reference into a commit point (preserving id reuse). */
export function refToCommitPoint(ref: PointRefInput): CommitPoint {
  if ('pointId' in ref) return { kind: 'existing', id: ref.pointId };
  return { kind: 'new', x: ref.x, y: ref.y };
}

/**
 * A plane-local batch of new geometry to append to a sketch, referencing its
 * own points by index — the same shape the browser's sketch tools produce.
 */
export interface EntityCommit {
  readonly points: readonly CommitPoint[];
  readonly lines?: readonly { readonly start: number; readonly end: number }[];
  readonly circles?: readonly { readonly center: number; readonly radius: number }[];
  readonly arcs?: readonly {
    readonly center: number;
    readonly radius: number;
    readonly startAngle: number;
    readonly endAngle: number;
    readonly direction: ArcDirection;
  }[];
}

/** The ids of the entities a commit created, grouped by kind. */
export interface CreatedEntityIds {
  readonly points: string[];
  readonly lines: string[];
  readonly circles: string[];
  readonly arcs: string[];
}

export interface ResolvedCommit {
  readonly entities: SketchEntity[];
  readonly created: CreatedEntityIds;
}

/**
 * Resolves an {@link EntityCommit} into concrete sketch entities appended to
 * `existing`, minting ids with `nextId`. New points coincident (within 1e-6)
 * with an existing point or one created earlier in the same commit are merged
 * so shared corners become coincident by id; zero-length lines are dropped.
 * This mirrors the browser's `buildSketchUpdateCommand` exactly so an agent and
 * a human produce byte-identical documents.
 */
export function resolveCommit(
  existing: readonly SketchEntity[],
  commit: EntityCommit,
  construction: boolean,
  nextId: () => string,
): ResolvedCommit {
  const created: SketchEntity[] = [];
  const createdIds: CreatedEntityIds = { points: [], lines: [], circles: [], arcs: [] };

  const findPoint = (x: number, y: number): string | null => {
    for (const entity of [...existing, ...created]) {
      if (entity.kind === 'point' && approxEqual(entity.x, x) && approxEqual(entity.y, y)) {
        return entity.id;
      }
    }
    return null;
  };

  const resolvePoint = (point: CommitPoint): string => {
    if (point.kind === 'existing') return point.id;
    const reused = findPoint(point.x, point.y);
    if (reused) return reused;
    const id = nextId();
    created.push({ id, kind: 'point', x: point.x, y: point.y, construction });
    createdIds.points.push(id);
    return id;
  };

  const pointIds = commit.points.map(resolvePoint);

  for (const line of commit.lines ?? []) {
    const startId = pointIds[line.start];
    const endId = pointIds[line.end];
    if (startId === undefined || endId === undefined || startId === endId) continue;
    const id = nextId();
    created.push({ id, kind: 'line', startId, endId, construction });
    createdIds.lines.push(id);
  }

  for (const circle of commit.circles ?? []) {
    const centerId = pointIds[circle.center];
    if (centerId === undefined) continue;
    const id = nextId();
    created.push({ id, kind: 'circle', centerId, radius: circle.radius, construction });
    createdIds.circles.push(id);
  }

  for (const arc of commit.arcs ?? []) {
    const centerId = pointIds[arc.center];
    if (centerId === undefined) continue;
    const id = nextId();
    created.push({
      id,
      kind: 'arc',
      centerId,
      radius: arc.radius,
      startAngle: arc.startAngle,
      endAngle: arc.endAngle,
      direction: arc.direction,
      construction,
    });
    createdIds.arcs.push(id);
  }

  return { entities: [...existing, ...created], created: createdIds };
}

/**
 * Validates `command` against the shared reducer and the document package's
 * canonical whole-document schema *before* it is persisted, so cross-feature
 * checks the per-command schema can't see (dangling references, duplicate ids,
 * an extrude pointing at a missing sketch) are surfaced as structured errors
 * and a rejected command never mutates the document.
 */
export type ProspectiveValidation = { readonly ok: true } | { readonly ok: false; readonly message: string };

export function validateProspectiveCommand(document: CadDocumentV2, command: CadCommand): ProspectiveValidation {
  let next: CadDocumentV2;
  try {
    next = applyCommand(document, command);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  const parsed = parseCadDocument(next);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.message };
  }
  return { ok: true };
}

/** A flattened, machine-readable report of a single solve. */
export interface SketchSolveReport {
  readonly status: SolveStatus | 'invalid';
  readonly remainingDof: number;
  readonly converged: boolean;
  readonly iterations: number;
  readonly residualNorm: number;
  readonly diagnostics: readonly SolveDiagnostic[];
  readonly solvedSketch: SketchFeature;
  /** Whether the solve passed input validation (false only for an `invalid` status). */
  readonly valid: boolean;
}

/**
 * Solves a sketch grounded on its first point and flattens the result into a
 * report. A sketch with no points is reported `under-constrained` (rather than
 * trivially fully-constrained), matching the browser's `computeSketchSolve`.
 */
export function solveSketchReport(sketch: SketchFeature): SketchSolveReport {
  if (!sketch.entities.some((entity) => entity.kind === 'point')) {
    return {
      status: 'under-constrained',
      remainingDof: 0,
      converged: true,
      iterations: 0,
      residualNorm: 0,
      diagnostics: [],
      solvedSketch: sketch,
      valid: true,
    };
  }

  const anchor = firstAnchorPointId(sketch);
  const result = solveSketch(sketch, anchor ? { anchoredPointIds: [anchor] } : {});

  if (!result.ok) {
    return {
      status: 'invalid',
      remainingDof: 0,
      converged: false,
      iterations: 0,
      residualNorm: Number.POSITIVE_INFINITY,
      diagnostics: result.diagnostics,
      solvedSketch: result.sketch,
      valid: false,
    };
  }

  return {
    status: result.status,
    remainingDof: result.remainingDof,
    converged: result.converged,
    iterations: result.iterations,
    residualNorm: result.residualNorm,
    diagnostics: result.diagnostics,
    solvedSketch: result.sketch,
    valid: true,
  };
}

/** Re-export for tools that build constraints. */
export type { SketchConstraint };
