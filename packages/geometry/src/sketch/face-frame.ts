import type { Vec3 } from '../math/vec3.js';
import { cross, normalize } from '../math/vec3.js';
import type { PlaneFrame } from './plane.js';

/**
 * Builds a deterministic, right-handed orthonormal tangent basis for a plane
 * with the given (not necessarily unit) `normal`. The reference world axis is
 * the principal axis least aligned with the normal — the one with the smallest
 * absolute component, ties broken X < Y < Z — so the cross product that seeds
 * `xAxis` is always well-conditioned and the whole basis is a pure function of
 * the normal. That purity is what makes a face's sketch frame reproducible
 * byte-for-byte across a rebuild or reload: an unchanged face normal yields an
 * unchanged basis, independent of tessellation or evaluation order.
 *
 * The returned axes satisfy `cross(xAxis, yAxis) === normal` (right-handed),
 * mirroring the invariant every {@link PlaneFrame} upholds.
 */
export function orthonormalBasisFromNormal(normal: Vec3): { xAxis: Vec3; yAxis: Vec3 } {
  const n = normalize(normal);
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  let ref: Vec3;
  if (ax <= ay && ax <= az) ref = [1, 0, 0];
  else if (ay <= az) ref = [0, 1, 0];
  else ref = [0, 0, 1];
  const xAxis = normalize(cross(ref, n));
  const yAxis = cross(n, xAxis);
  return { xAxis, yAxis };
}

/**
 * Assembles a {@link PlaneFrame} for a planar face from a representative point
 * on the face (`origin`, typically its centroid) and its outward `normal`. The
 * tangent basis comes from {@link orthonormalBasisFromNormal}, so the frame is
 * deterministic and orientation-stable; embedding sketch-local 2D coordinates
 * through it (via `sketchPointToModel`) places geometry exactly on the face.
 */
export function buildFaceFrame(origin: Vec3, normal: Vec3): PlaneFrame {
  const n = normalize(normal);
  const { xAxis, yAxis } = orthonormalBasisFromNormal(n);
  return { origin, xAxis, yAxis, normal: n };
}
