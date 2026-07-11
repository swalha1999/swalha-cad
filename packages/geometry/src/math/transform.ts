import type { Mat4 } from './mat4.js';
import { fromRotationDeg, fromScale, fromTranslation, multiply, normalMatrix, transformDirection, transformPoint } from './mat4.js';
import type { Vec3 } from './vec3.js';
import { normalize } from './vec3.js';

export interface Transform {
  translation: Vec3;
  rotationDeg: Vec3;
  scale: Vec3;
}

/** Composes a transform as T * R * S: scale is applied first, then rotation, then translation. */
export function composeTransformMatrix(t: Transform): Mat4 {
  return multiply(fromTranslation(t.translation), multiply(fromRotationDeg(t.rotationDeg), fromScale(t.scale)));
}

/**
 * Composes a child's world matrix from its parent's world matrix and its own
 * local transform matrix. The local transform is applied first, then the
 * parent's — i.e. equivalent to multiply(parentWorld, local).
 */
export function composeWorldMatrix(parentWorld: Mat4, local: Mat4): Mat4 {
  return multiply(parentWorld, local);
}

export function transformPointBy(t: Transform, p: Vec3): Vec3 {
  return transformPoint(composeTransformMatrix(t), p);
}

/**
 * Transforms a normal by the inverse-transpose of the transform's matrix so
 * it stays perpendicular to transformed tangents under non-uniform scale,
 * then re-normalizes it to unit length.
 */
export function transformNormalBy(t: Transform, n: Vec3): Vec3 {
  const nMatrix = normalMatrix(composeTransformMatrix(t));
  if (!nMatrix) {
    throw new Error('Cannot transform a normal by a singular (non-invertible) transform');
  }
  return normalize(transformDirection(nMatrix, n));
}
