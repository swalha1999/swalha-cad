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
export { segmentsIntersect, findLoopSelfIntersections, lineLineIntersection, lineArcIntersections, arcArcIntersections } from './sketch/intersections.js';
export type { CurveLoopSegment } from './sketch/intersections.js';
export type { LineLoopProfile, CircleProfile, SketchProfile, ProfileResult } from './sketch/profile.js';
export { detectSketchProfile } from './sketch/profile.js';
// Pure plane-local construction geometry for the Onshape-style creation tools:
// centre/3-point rectangles, circumcircles (3-point circle), and regular
// polygons. Each returns null for a degenerate/collinear input so tools reject
// it without mutating the document.
export type { RectangleCorners, Circle } from './sketch/shapes.js';
export { centerRectangleCorners, circumcircle, regularPolygonVertices, threePointRectangleCorners } from './sketch/shapes.js';
// Pure plane-local arc/slot math for the Onshape-style arc creation tools:
// 3-point, center-point, and tangent-continuation arcs plus straight slots.
// Arcs are described exactly as the document stores them (center/radius/angles/
// direction); each function returns null for degenerate input.
export type { ArcDirection, ArcGeometry, SlotTangentPoints, StraightSlot } from './sketch/arc.js';
export { arcEndpoints, centerPointArc, sampleArc, signedArcSweep, straightSlot, tangentArc, threePointArc } from './sketch/arc.js';
// Pure plane-local reflection for the Onshape-style sketch Mirror tool: reflect a
// point or a circular arc across an infinite straight axis, preserving distances
// (radius/sweep magnitude) and reversing orientation (arc direction).
export { reflectArcAcrossLine, reflectPointAcrossLine } from './sketch/mirror.js';
export type { FilletLineInput, FilletResult, FilletRejection, FilletSolution, RetainedEndpoint } from './sketch/fillet.js';
export { filletTwoLines, MIN_CORNER_ANGLE, MAX_CORNER_ANGLE } from './sketch/fillet.js';
// Watertight profile extrusion: sweep a sketch's single detected closed
// profile (one line loop or one circle) along its plane normal into an indexed
// hard-shaded solid, triangulating caps deterministically and generating side
// walls directly. Reuses the plane/profile APIs above and the mesh-validation
// invariants (watertight, outward winding, unit normals) as its contract.
export type { ProfileTriangle } from './features/triangulate-profile.js';
export { triangulateSimplePolygon } from './features/triangulate-profile.js';
export type { ExtrudeOptions, ExtrudeErrorCode, ExtrudeError, ExtrudeResult } from './features/extrude.js';
export { extrudeSketch } from './features/extrude.js';
// Deterministic document evaluation: project a V2 document's retained M1
// primitives and in-order features into the ordered solid bodies a renderer
// and STL exporter consume, resolving sketch references and returning
// structured diagnostics (never stale geometry) for broken/invalid features.
export type {
  EvaluatedBodyGeometry,
  EvaluatedBody,
  EvaluationDiagnosticCode,
  EvaluationDiagnostic,
  EvaluatedDocument,
} from './features/evaluate-document.js';
export { evaluateDocument, evaluatedWorldBounds } from './features/evaluate-document.js';
// Scoped deterministic geometric constraint solver: solves M2's supported
// coincidence/horizontal/vertical/distance/radius/angle constraints over point
// coordinates and circle radii with a damped Gauss-Newton iteration, then
// reports under-constrained / fully-constrained / conflicting status.
export type {
  SolveStatus,
  SolveDiagnosticCode,
  SolveDiagnostic,
  SolveOptions,
  SolvedResult,
  InvalidResult,
  SolveResult,
} from './sketch/constraints/types.js';
export { solveSketch } from './sketch/constraints/solver.js';

