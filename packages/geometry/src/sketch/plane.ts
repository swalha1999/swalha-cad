import type { Vec3 } from '../math/vec3.js';
import { add, cross, dot, scale, subtract } from '../math/vec3.js';

/** Selects one of the three principal origin planes a sketch is drawn on. */
export type SketchPlane = 'XY' | 'XZ' | 'YZ';

/** A 2D coordinate expressed in a sketch's own local frame, never in model space directly. */
export type Vec2 = readonly [number, number];

/**
 * An orthonormal, right-handed model-space frame that a sketch's 2D entities
 * are embedded into: `normal` is always `cross(xAxis, yAxis)`, so the sketch's
 * (x, y, normal) axes form a right-handed triple, mirroring how model space's
 * own (X, Y, Z) axes relate. `sketchPointToModel`/`sketchVectorToModel` embed
 * sketch-local coordinates through this frame into model space, and
 * `modelPointToSketch`/`modelVectorToSketch` project the other way. The
 * resulting model-space points are the same "model space" that
 * `composeTransformMatrix` (`math/transform.ts`) then carries through the
 * model → world → camera → projection → viewport pipeline documented in
 * docs/graphics-pipeline.md — a sketch plane is the frame a feature's own
 * geometry is authored in before any entity Transform is applied.
 */
export interface PlaneFrame {
  readonly origin: Vec3;
  readonly xAxis: Vec3;
  readonly yAxis: Vec3;
  readonly normal: Vec3;
}

function assertFiniteVec2(v: Vec2, label: string): void {
  if (!Number.isFinite(v[0]) || !Number.isFinite(v[1])) {
    throw new Error(`${label} must have finite coordinates, got [${v[0]}, ${v[1]}]`);
  }
}

function assertFiniteVec3(v: Vec3, label: string): void {
  if (!Number.isFinite(v[0]) || !Number.isFinite(v[1]) || !Number.isFinite(v[2])) {
    throw new Error(`${label} must have finite coordinates, got [${v[0]}, ${v[1]}, ${v[2]}]`);
  }
}

function makeFrame(xAxis: Vec3, yAxis: Vec3): PlaneFrame {
  return { origin: [0, 0, 0], xAxis, yAxis, normal: cross(xAxis, yAxis) };
}

/**
 * Canonical origin-plane frames. Sketch axes are named after the model axes
 * they align with, so `XZ`'s normal falls out of the right-hand rule as
 * `cross(X, Z) = -Y` rather than `+Y` — the frame is still right-handed, just
 * not aligned with the model's own `+Y`.
 */
const PLANE_FRAMES: Readonly<Record<SketchPlane, PlaneFrame>> = {
  XY: makeFrame([1, 0, 0], [0, 1, 0]),
  XZ: makeFrame([1, 0, 0], [0, 0, 1]),
  YZ: makeFrame([0, 1, 0], [0, 0, 1]),
};

/** Returns the orthonormal, right-handed model-space frame for a named principal sketch plane. */
export function getPlaneFrame(plane: SketchPlane): PlaneFrame {
  const frame = PLANE_FRAMES[plane];
  if (!frame) {
    throw new Error(`Unknown sketch plane: ${JSON.stringify(plane)}`);
  }
  return frame;
}

/** Embeds a sketch-local point into model space: `origin + x * xAxis + y * yAxis`. */
export function sketchPointToModel(frame: PlaneFrame, point: Vec2): Vec3 {
  assertFiniteVec2(point, 'Sketch point');
  return add(frame.origin, add(scale(frame.xAxis, point[0]), scale(frame.yAxis, point[1])));
}

/** Embeds a sketch-local displacement into model space. Unlike a point, ignores the frame's origin. */
export function sketchVectorToModel(frame: PlaneFrame, vector: Vec2): Vec3 {
  assertFiniteVec2(vector, 'Sketch vector');
  return add(scale(frame.xAxis, vector[0]), scale(frame.yAxis, vector[1]));
}

/**
 * Orthogonally projects a model-space point onto the plane and expresses it
 * in sketch-local coordinates, discarding any offset along `normal`.
 */
export function modelPointToSketch(frame: PlaneFrame, point: Vec3): Vec2 {
  assertFiniteVec3(point, 'Model point');
  const relative = subtract(point, frame.origin);
  return [dot(relative, frame.xAxis), dot(relative, frame.yAxis)];
}

/**
 * Orthogonally projects a model-space vector onto the plane's basis. Unlike a
 * point, does not subtract the frame's origin first.
 */
export function modelVectorToSketch(frame: PlaneFrame, vector: Vec3): Vec2 {
  assertFiniteVec3(vector, 'Model vector');
  return [dot(vector, frame.xAxis), dot(vector, frame.yAxis)];
}
