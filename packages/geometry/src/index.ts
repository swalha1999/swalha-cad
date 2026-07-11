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
// Sketch topology and profile detection: validate a sketch's non-construction
// line/circle entities and identify the single closed profile (one line loop
// or one standalone circle) that a later extrude feature can consume.
export type {
  SketchPointEntity,
  SketchLineEntity,
  SketchCircleEntity,
  SketchEntityIndex,
  TopologyIssueKind,
  TopologyIssue,
  ClosedLineLoop,
  LineLoopTopologyResult,
} from './sketch/topology.js';
export { indexSketchEntities, analyzeLineLoopTopology } from './sketch/topology.js';
export type { LoopSegment, SelfIntersection } from './sketch/intersections.js';
export { segmentsIntersect, findLoopSelfIntersections } from './sketch/intersections.js';
export type { LineLoopProfile, CircleProfile, SketchProfile, ProfileResult } from './sketch/profile.js';
export { detectSketchProfile } from './sketch/profile.js';

