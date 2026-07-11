import type { Transform } from '@swalha-cad/document';
import type { Object3D } from 'three';
import { Euler, MathUtils } from 'three';

/** Collapses `-0` to `0` so serialized transforms don't carry a negative-zero sign bit. */
function withoutNegativeZero(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * Reads an `Object3D`'s position/quaternion/scale back into a document
 * {@link Transform}, the inverse of `scene-sync`'s `applyModelTransform`
 * (which composes translate * rotate(X,Y,Z) * scale using Euler order
 * `'ZYX'`). Used after a transform-gizmo drag to write the dragged pose
 * back into the CAD document.
 */
export function transformFromObject(object: Object3D): Transform {
  const euler = new Euler().setFromQuaternion(object.quaternion, 'ZYX');
  return {
    translation: [
      withoutNegativeZero(object.position.x),
      withoutNegativeZero(object.position.y),
      withoutNegativeZero(object.position.z),
    ],
    rotationDeg: [
      withoutNegativeZero(MathUtils.radToDeg(euler.x)),
      withoutNegativeZero(MathUtils.radToDeg(euler.y)),
      withoutNegativeZero(MathUtils.radToDeg(euler.z)),
    ],
    scale: [withoutNegativeZero(object.scale.x), withoutNegativeZero(object.scale.y), withoutNegativeZero(object.scale.z)],
  };
}
