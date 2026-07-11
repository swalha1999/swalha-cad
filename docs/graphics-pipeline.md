# Graphics pipeline: model → world → camera → projection → viewport

This document maps the standard real-time rendering pipeline, as covered in
lecture, onto the concrete types and functions in `packages/geometry` and
`packages/renderer`. SWALHA CAD never lets the renderer's Three.js objects
become domain state — `CadDocumentV1` is the single source of truth, and
everything below is a one-way, re-derivable projection of it.

## 1. Model space

Each `CadEntity` stores a `Primitive` (box, cylinder, or L-bracket) and a
`Transform` (`translation`, `rotationDeg`, `scale`). `buildPrimitiveMesh`
(`packages/geometry/src/build-primitive-mesh.ts`) turns the primitive's
parameters into an `IndexedMesh` — positions, indices, and normals — entirely
in the primitive's own local (model) coordinate frame. This is the
*geometry + connectivity + attributes* split from lecture: positions/indices
are connectivity-bearing geometry, normals are a per-vertex attribute, and
neither depends on where the entity sits in the scene.

`packages/renderer/src/mesh-adapter.ts#createBufferGeometry` wraps that same
`IndexedMesh` into an indexed `THREE.BufferGeometry` with no copying — the
`position`/`normal` attributes and the index buffer alias the mesh's typed
arrays directly. The geometry produced here is still in model space.

## 2. Model → world (the local transform)

`Transform` is composed into a 4x4 model matrix by
`composeTransformMatrix` (`packages/geometry/src/math/transform.ts`) as
`T * R * S`: scale first, then rotation, then translation, applied to a
point as `T * (R * (S * p))`. Rotation itself is `Rz * Ry * Rx`, i.e. the
entity rotates about its local X axis first, then Y, then Z.

`packages/renderer/src/scene-sync.ts#applyModelTransform` reproduces the same
composition on the corresponding `THREE.Mesh`, using Three's `'ZYX'` Euler
order — Three's order string denotes left-to-right matrix composition
(`'ZYX'` → `Rz * Ry * Rx`), which is the order that applies X first, matching
`composeTransformMatrix` exactly. This equivalence is asserted directly in
`scene-sync.test.ts` by comparing `mesh.matrix.elements` against
`composeTransformMatrix(transform)` element-for-element.

`SceneSync` has no notion of a scene graph hierarchy beyond this single local
transform per entity — M1's document model is flat, so each entity's model
matrix *is* its world matrix. `composeWorldMatrix` in the geometry package
documents how a deeper hierarchy would fold a parent's world matrix in
(`multiply(parentWorld, local)`) for when nested assemblies are introduced.

## 3. World → camera (the view transform)

The camera's position/orientation in world space defines the view transform:
the matrix that maps world-space points into the camera's own local frame
(camera at the origin, looking down its own axis). `packages/renderer/src/camera.ts`
delegates this to `THREE.PerspectiveCamera`/`THREE.OrthographicCamera`, which
derive their view matrix from the camera object's own model matrix (position,
rotation) the same way any other `Object3D`'s world matrix is derived — the
camera is simply an entity whose *inverse* world matrix is used as the view
transform. SWALHA CAD does not store the camera in `CadDocumentV1`: it is
viewport-local UI state, not part of the document.

## 4. Camera → projection (perspective vs. orthographic)

Projection maps camera space into clip space. `camera.ts` builds both kinds:

- `createPerspectiveCamera` builds a `THREE.PerspectiveCamera` from a
  vertical field of view, aspect ratio, and near/far planes. Its projection
  matrix performs the perspective divide: element `[11]` is `-1` and element
  `[15]` is `0`, so that after the vertex shader's `w`-divide, depth
  foreshortens with distance — this is what makes farther objects appear
  smaller, exactly as in lecture.
- `createOrthographicCamera` builds a `THREE.OrthographicCamera` from a
  symmetric world-space `viewHeight` (with width derived from the viewport's
  aspect ratio) and near/far planes. Its projection matrix is affine —
  element `[11]` is `0` and element `[15]` is `1` — so there is no
  perspective divide and parallel lines stay parallel, matching CAD
  orthographic/engineering views.

Both of these element-level distinctions are asserted in `camera.test.ts` so
the perspective/orthographic difference is verified as a projection-matrix
property, not just an object type check. `resizePerspectiveCamera` and
`resizeOrthographicCamera` re-derive the frustum from a new viewport without
changing which projection family is in use, keeping resize a pure
recomputation rather than new domain state.

## 5. Projection → viewport (rasterization)

The final mapping from clip-space coordinates to pixel coordinates in a
render target — the viewport transform and rasterization itself — is
delegated entirely to WebGL via `THREE.WebGLRenderer`, which is intentionally
outside this package's scope (`packages/renderer` only produces the scene,
geometries, and cameras that a renderer consumes). This matches the lecture's
treatment of rasterization as a hardware-implemented stage that the
application configures rather than reimplements.

Two rasterization-stage settings are configured explicitly rather than left
to defaults, in `scene-sync.ts#createEntityMaterial`:

- **Depth testing** (`material.depthTest = true`) — the Z-buffer check that
  resolves visibility between overlapping triangles per pixel.
- **Back-face culling** (`material.side = THREE.FrontSide`) — triangles
  whose winding faces away from the camera are discarded before
  rasterization. Because every primitive mesh in `packages/geometry` is
  validated to have outward-facing winding (`isWindingOutward`,
  `areNormalsOutward` in `mesh-validation.ts`), back-face culling is safe to
  enable unconditionally: a correctly wound, outward-facing solid never
  needs its back faces rendered.

## GPU resource lifetime

`SceneSync` is the only place that owns Three.js `BufferGeometry`/`Material`
instances. On every `sync(document)` call it:

1. Creates a `BufferGeometry`/`Material`/`Mesh` for entities it has not seen
   before.
2. Reuses the existing `Mesh` and `BufferGeometry` for an entity whose
   primitive is unchanged, only updating its model transform and visibility.
3. Replaces the `BufferGeometry` (disposing the old one) when an entity's
   primitive parameters change.
4. Removes and disposes the `Mesh`'s geometry and material when an entity is
   no longer present in the document.
5. `SceneSync#dispose()` releases everything it currently owns.

This keeps GPU memory bounded by the current document rather than by every
document state that ever existed, without ever storing Three.js state back
onto `CadEntity`/`CadDocumentV1`.
