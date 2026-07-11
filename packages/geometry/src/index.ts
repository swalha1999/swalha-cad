export type { Vec3 } from './math/vec3.js';
export { add, cross, dot, length, normalize, scale, subtract } from './math/vec3.js';
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
export type { IndexedMesh } from './mesh.js';
export { getNormal, getPosition, getTriangleVertexIndices, triangleCount, vertexCount } from './mesh.js';
export type { MeshBounds } from './mesh-validation.js';
export {
  areIndicesInRange,
  areNormalsOutward,
  areNormalsUnitLength,
  computeMeshBounds,
  hasZeroAreaTriangles,
  isWatertight,
  isWindingOutward,
  triangleArea,
} from './mesh-validation.js';
export { buildBoxMesh } from './primitives/box.js';
export { buildCylinderMesh } from './primitives/cylinder.js';
export { buildLBracketMesh } from './primitives/l-bracket.js';
export { buildPrimitiveMesh } from './build-primitive-mesh.js';
// Sketch coordinate frames: map a sketch's 2D points/vectors into the model
// space that composeTransformMatrix/composeWorldMatrix then carry through the
// model → world → camera → projection → viewport pipeline (docs/graphics-pipeline.md).
export type { PlaneFrame, SketchPlane, Vec2 } from './sketch/plane.js';
export {
  getPlaneFrame,
  modelPointToSketch,
  modelVectorToSketch,
  sketchPointToModel,
  sketchVectorToModel,
} from './sketch/plane.js';

