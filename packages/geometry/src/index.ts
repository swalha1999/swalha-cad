export type { Vec3 } from './math/vec3.js';
export { add, cross, dot, length, normalize, scale } from './math/vec3.js';
export type { Mat4 } from './math/mat4.js';
export {
  fromRotationDeg,
  fromScale,
  fromTranslation,
  identity,
  invert,
  multiply,
  normalMatrix,
  transformDirection,
  transformPoint,
  transpose,
} from './math/mat4.js';
export type { Transform } from './math/transform.js';
export { composeTransformMatrix, composeWorldMatrix, transformNormalBy, transformPointBy } from './math/transform.js';

