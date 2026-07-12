import type { ArcDirection, ArcGeometry } from './arc.js';
import type { Vec2 } from './plane.js';

/**
 * Pure plane-local math for the Onshape-style sketch Fillet between two straight
 * lines. Given two line segments (each with the plane-local point the user picked
 * on it) and a radius, it computes the single tangent arc that rounds the corner
 * where the two lines meet — trimming or extending each line back to its tangent
 * point. Everything works in the sketch's own 2D frame (millimetres, y up) on
 * plain `[x, y]` tuples and is side-effect free and deterministic, so the web
 * fillet reducer, its live preview, and the unit tests share one authoritative
 * geometric definition.
 *
 * The corner is the intersection of the two *infinite* lines; the pick point on
 * each line selects which ray of that line is retained (the far endpoint on the
 * picked side survives, the corner-side end is replaced by the tangent point).
 * The fillet is the internal (minor) arc tangent to both retained rays, nestled in
 * the angular wedge between them, so it always rounds the picked corner. Every
 * degenerate configuration — parallel/collinear lines, a zero-angle or
 * straight (180°) corner, a non-finite/zero/negative radius, a radius too large
 * to fit the bounded retained segments, or a pick that cannot disambiguate the
 * corner — is refused with a typed reason and yields no geometry.
 */

/** A line segment plus the plane-local point the user picked on it (used to choose the retained ray). */
export interface FilletLineInput {
  /** The line's authored start endpoint. */
  readonly a: Vec2;
  /** The line's authored end endpoint. */
  readonly b: Vec2;
  /** The plane-local point the user picked on (or near) this line; selects which side of the corner survives. */
  readonly pick: Vec2;
}

/** Which authored endpoint of a line the fillet keeps: `'a'` (start) or `'b'` (end). */
export type RetainedEndpoint = 'a' | 'b';

/** The resolved geometry of a fillet: its tangent arc, the two tangent points, the corner, and each line's kept endpoint. */
export interface FilletSolution {
  /** The rounding arc, expressed exactly as the document stores an arc entity. */
  readonly arc: ArcGeometry;
  /** Tangent point where the arc meets line A (the new endpoint of line A). */
  readonly tangentA: Vec2;
  /** Tangent point where the arc meets line B (the new endpoint of line B). */
  readonly tangentB: Vec2;
  /** The corner (intersection of the two infinite lines) the fillet rounds. */
  readonly corner: Vec2;
  /** Which authored endpoint of line A is retained (the far end on the picked side). */
  readonly retainedA: RetainedEndpoint;
  /** Which authored endpoint of line B is retained. */
  readonly retainedB: RetainedEndpoint;
}

/** Why a fillet could not be computed; each yields no geometry and a caller-facing diagnostic. */
export type FilletRejection =
  | 'radius-invalid'
  | 'parallel'
  | 'zero-angle'
  | 'straight-angle'
  | 'radius-too-large'
  | 'ambiguous'
  | 'degenerate';

export type FilletResult =
  | { readonly ok: true; readonly solution: FilletSolution }
  | { readonly ok: false; readonly reason: FilletRejection };

/**
 * Smallest and largest corner opening angle (radians) a fillet accepts. Below the
 * minimum the retained rays are effectively collinear/coincident (a zero-angle
 * corner); above the maximum they are effectively a straight line (a 180° corner).
 * Both extremes push the tangent points and centre to infinity, so they are
 * refused rather than producing a wild arc.
 */
export const MIN_CORNER_ANGLE = 1e-4;
export const MAX_CORNER_ANGLE = Math.PI - 1e-4;

/** Below this |cross(u1, u2)| the two unit line directions are treated as parallel (no unique corner). */
const PARALLEL_EPS = 1e-9;
/** A pick whose signed offset from the corner along its line is within this (mm) cannot pick a side. */
const PICK_SIDE_EPS = 1e-9;
/** Fractional slack keeping a tangent point strictly inside the retained segment (leaves a non-degenerate remnant). */
const FIT_EPS = 1e-9;

function sub(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}
function dot(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1];
}
/** z-component of the 2D cross product a×b. */
function cross(a: Vec2, b: Vec2): number {
  return a[0] * b[1] - a[1] * b[0];
}
function add(a: Vec2, scale: number, dir: Vec2): Vec2 {
  return [a[0] + scale * dir[0], a[1] + scale * dir[1]];
}
function len(a: Vec2): number {
  return Math.hypot(a[0], a[1]);
}

/** Per-line resolved frame: the corner-relative retained direction and how far the retained material reaches. */
interface LineFrame {
  /** Unit direction from the corner toward the retained (picked) side of the line. */
  readonly dir: Vec2;
  /** Distance (mm) from the corner to the retained far endpoint along `dir`; the tangent point must fall short of this. */
  readonly retainedLength: number;
  /** Which authored endpoint (`'a'`/`'b'`) is the retained far endpoint. */
  readonly retained: RetainedEndpoint;
}

/**
 * Resolves one line into a corner-relative frame: the outward retained direction
 * (toward the picked side of the corner) and the reach of the retained material.
 * Returns `null` when the pick sits on the corner itself (no side to pick) or the
 * degenerate line has no length.
 */
function lineFrame(line: FilletLineInput, corner: Vec2): LineFrame | null {
  const axis = sub(line.b, line.a);
  const length = len(axis);
  if (length === 0) return null;
  const u: Vec2 = [axis[0] / length, axis[1] / length];
  // Signed positions along the unit axis measured from the corner.
  const cornerT = dot(sub(corner, line.a), u);
  const pickT = dot(sub(line.pick, line.a), u) - cornerT;
  if (Math.abs(pickT) < PICK_SIDE_EPS) return null;
  const side = pickT > 0 ? 1 : -1;
  const dir: Vec2 = [side * u[0], side * u[1]];
  // Distance of each authored endpoint from the corner along the retained direction.
  const aReach = (0 - cornerT) * side;
  const bReach = (length - cornerT) * side;
  const retained: RetainedEndpoint = aReach >= bReach ? 'a' : 'b';
  const retainedLength = Math.max(aReach, bReach);
  if (retainedLength <= 0) return null;
  return { dir, retainedLength, retained };
}

/** Wraps an angle into [0, 2π). */
function wrap(angle: number): number {
  const TWO_PI = Math.PI * 2;
  const m = angle % TWO_PI;
  return m < 0 ? m + TWO_PI : m;
}

/**
 * Computes the fillet between two lines at the corner their infinite extensions
 * form, on the side each line's pick point selects. Pure — never mutates. Returns
 * a typed rejection instead of throwing for every degenerate configuration.
 */
export function filletTwoLines(lineA: FilletLineInput, lineB: FilletLineInput, radius: number): FilletResult {
  if (!Number.isFinite(radius) || radius <= 0) return { ok: false, reason: 'radius-invalid' };

  const axisA = sub(lineA.b, lineA.a);
  const axisB = sub(lineB.b, lineB.a);
  const lenA = len(axisA);
  const lenB = len(axisB);
  if (lenA === 0 || lenB === 0) return { ok: false, reason: 'degenerate' };
  const uA: Vec2 = [axisA[0] / lenA, axisA[1] / lenA];
  const uB: Vec2 = [axisB[0] / lenB, axisB[1] / lenB];

  // Corner = intersection of the two infinite lines. Parallel/collinear → no unique corner.
  const denom = cross(uA, uB);
  if (Math.abs(denom) < PARALLEL_EPS) return { ok: false, reason: 'parallel' };
  const diff = sub(lineB.a, lineA.a);
  const tA = cross(diff, uB) / denom;
  const corner: Vec2 = add(lineA.a, tA, uA);
  if (!Number.isFinite(corner[0]) || !Number.isFinite(corner[1])) return { ok: false, reason: 'parallel' };

  const frameA = lineFrame(lineA, corner);
  const frameB = lineFrame(lineB, corner);
  if (!frameA || !frameB) return { ok: false, reason: 'ambiguous' };

  // Opening angle of the wedge between the retained rays.
  const cosPhi = Math.max(-1, Math.min(1, dot(frameA.dir, frameB.dir)));
  const phi = Math.acos(cosPhi);
  if (phi < MIN_CORNER_ANGLE) return { ok: false, reason: 'zero-angle' };
  if (phi > MAX_CORNER_ANGLE) return { ok: false, reason: 'straight-angle' };

  const halfPhi = phi / 2;
  const tangentDist = radius / Math.tan(halfPhi); // corner → tangent point along each ray
  const centerDist = radius / Math.sin(halfPhi); // corner → arc centre along the bisector
  if (!Number.isFinite(tangentDist) || !Number.isFinite(centerDist)) return { ok: false, reason: 'degenerate' };

  // The tangent point must fall strictly short of the retained far endpoint on each ray.
  if (tangentDist >= frameA.retainedLength * (1 - FIT_EPS)) return { ok: false, reason: 'radius-too-large' };
  if (tangentDist >= frameB.retainedLength * (1 - FIT_EPS)) return { ok: false, reason: 'radius-too-large' };

  const tangentA = add(corner, tangentDist, frameA.dir);
  const tangentB = add(corner, tangentDist, frameB.dir);

  // Arc centre lies along the wedge bisector; |d1 + d2| = 2·cos(φ/2) ≠ 0 since φ < π.
  const bisRaw: Vec2 = [frameA.dir[0] + frameB.dir[0], frameA.dir[1] + frameB.dir[1]];
  const bisLen = len(bisRaw);
  if (bisLen === 0) return { ok: false, reason: 'degenerate' };
  const bisector: Vec2 = [bisRaw[0] / bisLen, bisRaw[1] / bisLen];
  const center = add(corner, centerDist, bisector);

  const startAngle = Math.atan2(tangentA[1] - center[1], tangentA[0] - center[0]);
  const endAngle = Math.atan2(tangentB[1] - center[1], tangentB[0] - center[0]);
  // The fillet is the minor arc (sweep = π − φ < π). Pick the direction whose sweep is that minor angle.
  const direction: ArcDirection = wrap(endAngle - startAngle) <= Math.PI ? 'ccw' : 'cw';

  const arc: ArcGeometry = { center, radius, startAngle, endAngle, direction };
  return {
    ok: true,
    solution: {
      arc,
      tangentA,
      tangentB,
      corner,
      retainedA: frameA.retained,
      retainedB: frameB.retained,
    },
  };
}
