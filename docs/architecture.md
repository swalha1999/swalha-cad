# Architecture

SWALHA CAD is a pnpm/TypeScript monorepo built around one rule: **the
document is the source of truth, everything else is a projection of it.**
The browser never treats a Three.js object as domain state, and the MCP
server never mutates a document directly — both go through the same
serializable command layer.

Milestone 2 extends the model from standalone primitives to a **parametric
feature tree**: sketches and extrusions live in the document, and the rendered
and exported solids are *derived* from that tree on demand. The interaction
model borrows Onshape's Part Studio architecture and density; the parametric
feature/solver design takes a lesson from FreeCAD — keep features
tree-ordered and rebuildable, but scope the solver tightly and report conflicts
as structured status rather than mis-solving silently.

```text
apps/
├── web/          React CAD interface (Vite, Zustand, Three.js)
└── mcp/          MCP stdio server
packages/
├── document/     versioned CAD schema (V1+V2), migration, commands, reducer, history
├── geometry/     vector/matrix math, mesh primitives, sketch solver/profile, extrusion
├── renderer/     Three.js adapter: cameras and (derived) document → scene sync
└── export/       binary STL export of derived bodies
```

Dependency direction is one-way: `geometry` depends only on `document`
(for types); `renderer` and `export` depend on `document` and `geometry`;
`apps/web` and `apps/mcp` depend on whichever packages they need but never
on each other.

## The document model

`packages/document/src/types.ts` defines the canonical shape:

```ts
type Primitive =
  | { kind: 'box'; width: number; height: number; depth: number }
  | { kind: 'cylinder'; radius: number; height: number; segments: number }
  | { kind: 'lBracket'; width: number; height: number; depth: number; thickness: number };

interface CadEntity {
  id: string;
  name: string;
  primitive: Primitive;
  transform: Transform; // translation, rotationDeg, scale — all Vec3
  visible: boolean;
}

interface CadDocumentV1 {
  schemaVersion: 1;
  units: 'mm';
  entities: CadEntity[];
}

// V2 keeps M1 primitive bodies and adds a parametric feature tree.
type SketchEntity =
  | { id: string; kind: 'point'; x: number; y: number; construction: boolean }
  | { id: string; kind: 'line'; startId: string; endId: string; construction: boolean }
  | { id: string; kind: 'circle'; centerId: string; radius: number; construction: boolean }
  | { id: string; kind: 'arc'; /* center + endpoints + direction */ construction: boolean };

type SketchConstraint =
  | { id: string; kind: 'coincident'; pointA: string; pointB: string }
  | { id: string; kind: 'horizontal'; lineId: string }
  | { id: string; kind: 'vertical'; lineId: string }
  | { id: string; kind: 'distance'; pointA: string; pointB: string; value: number }
  | { id: string; kind: 'radius'; circleId: string; value: number }
  | { id: string; kind: 'angle'; lineA: string; lineB: string; valueDeg: number };

type CadFeature =
  | { id: string; kind: 'sketch'; name: string; plane: 'XY' | 'XZ' | 'YZ';
      entities: SketchEntity[]; constraints: SketchConstraint[]; visible: boolean }
  | { id: string; kind: 'extrude'; name: string; sketchId: string;
      depth: number; direction: 'normal' | 'symmetric'; visible: boolean };

interface CadDocumentV2 {
  schemaVersion: 2;
  units: 'mm';
  entities: CadEntity[]; // retained M1 primitive bodies
  features: CadFeature[];
}
```

`schema.ts` mirrors these types as Zod schemas and adds the domain rules
that types alone can't express: dimensions must be strictly positive, a
cylinder needs at least 3 segments, an L-bracket's `thickness` must be
strictly less than both its `width` and `height`, a distance/radius value must
be positive and finite, and an extrude must reference an existing sketch.
`parseCadDocument` is the single entry point every loader (browser file open,
MCP startup) runs untrusted JSON through. `migrate.ts` upgrades a valid V1
document to V2 in memory by adding an empty `features: []`; every save emits V2,
so V1 files keep loading without a separate code path downstream.

## Commands, the reducer, and undo/redo

All mutation is expressed as one of a small set of serializable commands —
entity and feature create/update/delete, plus a `batch` that applies several
atomically as one undoable transaction:

```ts
type CadCommand =
  | { type: 'entity.create'; entity: CadEntity }
  | { type: 'entity.update'; id: string; patch: CadEntityPatch }
  | { type: 'entity.delete'; id: string }
  | { type: 'feature.create'; feature: CadFeature }
  | { type: 'feature.update'; id: string; patch: CadFeaturePatch }
  | { type: 'feature.delete'; id: string }
  | { type: 'batch'; commands: CadCommand[] };
```

`reducer.ts#applyCommand` is a pure function, `(document, command) =>
document`, that throws for an update/delete against a missing id and never
mutates its input. Sketch editing, adding a constraint, creating or editing an
extrude, and dependency-aware deletion are all expressed as these commands (a
cascade deletion is one `batch`), so a single undo reverses a whole logical
operation. `history.ts` wraps the reducer in a `{ past, present, future }`
stack (`createHistory`, `applyCommandToHistory`, `undo`, `redo`) so undo/redo
is just history navigation, not a separate mutation path.

This is the layer that makes the UI and the AI agent equivalent: the
Zustand store in `apps/web/src/store/cad-store.ts` calls
`applyCommandToHistory` from click handlers and keyboard shortcuts; the MCP
tools in `apps/mcp/src/tools/*.ts` build the same `CadCommand` values from
tool input and apply them through `DocumentSession#applyCommand`, which
wraps `applyCommand` and persists atomically. Neither has a mutation path
that bypasses the reducer.

## Geometry: primitives as indexed meshes

`packages/geometry` builds every primitive as an `IndexedMesh` —
reusable vertex positions, a triangle index buffer, and per-vertex normals
— never as an STL-style flat vertex-per-triangle list. `buildPrimitiveMesh`
(`build-primitive-mesh.ts`) dispatches by `Primitive['kind']` to
`primitives/box.ts`, `primitives/cylinder.ts`, and `primitives/l-bracket.ts`,
all deterministic and side-effect free. `mesh-validation.ts` asserts the
properties a fabrication mesh must have — indices in range, outward
winding, unit-length outward normals, no zero-area triangles, and, for the
L-bracket, a watertight edge count (every undirected edge appears exactly
twice). The L-bracket is generated directly as a watertight concave
extrusion rather than as overlapping boxes, because overlapping internal
faces are invalid for fabrication.

`math/vec3.ts`, `math/mat4.ts`, and `math/transform.ts` implement vector and
4x4 matrix operations independently of Three.js, so the same transform math
used by the renderer and the STL exporter is unit-tested in isolation. See
[`docs/graphics-pipeline.md`](./graphics-pipeline.md) for how these pieces
compose into the full model → world → camera → projection → viewport
pipeline.

## Geometry: sketches, constraints, profiles, and extrusion

`packages/geometry/src/sketch` turns a 2D `SketchFeature` into validated 3D
geometry, all deterministic and Three.js-free:

- **`plane.ts`** maps a plane (`XY`/`XZ`/`YZ`) to orthonormal basis vectors and
  a normal, with round-tripping 2D↔3D projection so sketch coordinates land
  predictably in the world frame.
- **`topology.ts`, `intersections.ts`, `loop.ts`, `profile.ts`** analyze
  connectivity: point/line lookup, connected loops, self-intersection checks,
  and detection of exactly one closed, non-self-intersecting profile (a line
  loop or a single circle/curve loop). Construction geometry is excluded, and
  invalid topology returns *structured diagnostics* rather than being silently
  accepted. `arc.ts`, `curves.ts`, and `shapes.ts` provide the arc/slot and
  higher-level shape math the UI and MCP tools decompose into base entities.
- **`constraints/`** is the scoped solver. `equations.ts` expresses each
  supported constraint as a residual; `solver.ts` runs a damped Gauss–Newton
  iteration over point coordinates and radii with deterministic ordering,
  bounded iterations, a fixed tolerance, and rollback on divergence
  (horizontal/vertical/coincident are projected exactly first). `status.ts`
  classifies the result as `under-constrained`, `fully-constrained`, or
  `conflicting`. This is intentionally *not* a general industrial solver — the
  FreeCAD lesson applied here is to keep scope small and failures legible.
- **`features/triangulate-profile.ts` + `features/extrude.ts`** sweep a closed
  profile to a watertight `IndexedMesh` (normal or symmetric), reusing
  `mesh-validation.ts`: outward winding, unit normals, no zero-area triangles,
  and every manifold edge shared by exactly two faces. Open, self-intersecting,
  or degenerate profiles error instead of producing an invalid solid.
- **`features/evaluate-document.ts`** resolves the whole feature tree into
  derived render/export bodies in deterministic order, rebuilding an extrusion
  whenever its sketch or depth changes and reporting broken feature references.
  This single evaluator is what both the renderer and the STL exporter consume,
  so the browser preview and the fabrication mesh can never diverge.

## Renderer: document → Three.js, one-way

`packages/renderer/src/mesh-adapter.ts` wraps an `IndexedMesh`'s typed
arrays directly into a `THREE.BufferGeometry` (no copying). `camera.ts`
builds perspective and orthographic cameras. `scene-sync.ts#SceneSync` is
the only place in the codebase that owns Three.js `BufferGeometry` /
`Material` / `Mesh` instances: on every `sync(document)` call it creates,
updates in place, or disposes GPU resources to match the current document,
so GPU memory tracks the current document rather than every document state
that ever existed. It syncs both M1 primitive bodies and the derived solids
from `evaluate-document.ts`, so an extrusion rebuilds in the viewport the
instant its sketch or depth changes. Unselected bodies use a visibly lit
neutral material (no black/empty viewport) and the selected body gets a SWALHA
blue highlight. Depth testing and back-face culling are enabled explicitly,
which is safe because every mesh is validated to have outward-facing winding.

## Export: baking transforms to binary STL

`packages/export/src/stl.ts#exportDocumentToBinaryStl` evaluates the feature
tree, then flattens every *visible* body — M1 entities and derived extrusions
alike — into world-space triangles. Each vertex is passed through
`transformPointBy(entity.transform, …)`, and the facet normal is recomputed
from the transformed vertices rather than reused from the mesh's smooth
per-vertex normals, since binary STL stores one normal per facet. The result is
a standard 80-byte-header / uint32-count / 50-bytes-per-facet binary STL,
treated as millimetres (STL itself carries no unit metadata, so this is a
project-wide convention rather than something the format enforces).

## apps/web: the Onshape-inspired Part Studio

The shell (`apps/web/src/App.tsx`) is a dense CAD workspace, not a generic
dashboard: a document bar and an icon-first feature toolbar stacked at the top,
a left feature tree (origin, planes, sketches, features, bodies), the center
viewport, a contextual right panel, and a bottom Part Studio/status strip, with
resizable/collapsible side panels. Local UI primitives under `components/ui/`
adapt SWALHA-template tokens/patterns without importing its framework stack.
`store/cad-store.ts` is a framework-agnostic Zustand store (`createStore` from
`zustand/vanilla`) so its logic is unit-testable without React;
`store/cad-store-context.tsx` threads it through components via context.

- **Viewport** (`components/Viewport.tsx`, `viewport/*.ts`) owns the Three.js
  renderer, orbit controls, view cube, and a transform gizmo, and calls back
  into the store's `updateEntity` on drag — the gizmo never becomes the source
  of truth for a transform.
- **Sketch mode** (`sketch/*`) layers a focused free-coordinate 2D workspace
  over the viewport: a grouped, overflow-aware tool toolbar (`SketchToolGroups`),
  independent grid/snap settings (`SnapSettings`) that never quantize
  coordinates, the constraint toolbar and status, and a keyboard-first **D**
  distance tool. Every action routes through commands/history.
- **Extrude workflow** (`features/ExtrudeDialog`, `features/ExtrudePreview`)
  previews a candidate solid live via a *derived* render document as the depth
  changes, then commits it as one command; existing extrusions re-open for
  in-place depth editing.
- **Deletion** (`interactions/*`, `components/DeleteConfirmDialog`) is
  Onshape-style: unified selection, a dependency-aware cascade shown as an
  impact confirmation, reversible via undo, with focus guards so Backspace/Delete
  inside a numeric field edits text instead of deleting geometry.

`io/download.ts` and `io/open-document.ts` implement `.swcad.json` save/load and
STL download; opening a document re-validates and migrates it through
`parseCadDocument` and surfaces a visible error for anything malformed rather
than silently accepting it.

## apps/mcp: the same document, driven by an agent

See [`docs/mcp.md`](./mcp.md) for the full tool contract and a setup
example. In short: `DocumentSession` (`apps/mcp/src/document-session.ts`)
owns one `.swcad.json` path for the process lifetime, validates/migrates it at
startup, and persists atomically (write to a temp file, then rename) after
every applied command. `server.ts` registers the M1 primitive tools
(`create_primitive`, `list_entities`, `update_entity`, `delete_entity`,
`export_stl`) plus the M2 sketch/extrude tools (`create_sketch`,
`add_sketch_entity`, `add_constraint`, `solve_sketch`,
`create_or_update_extrude`, `list_features`, `get_feature`) against that
session. Every tool input is a Zod schema; writes are re-validated as a
`CadCommand` through the document package's canonical schema before they reach
the reducer, and topology/solver problems return as structured errors — so an
agent has exactly the browser's capabilities and can't construct something the
UI itself would reject.

## Testing strategy

- **Unit tests** (Vitest) sit beside their source files in every package
  and app, covering document validation/migration/reducer/history, geometry
  math, mesh generation, the sketch solver/topology/profile, extrusion and the
  feature-tree evaluator, STL byte-level structure, renderer adapter behavior,
  and web store/component behavior.
- **Browser E2E** (`apps/web/e2e`, Playwright at 1440×900) drives the real UI
  in Chromium. `sketch-extrude.spec.ts` proves the whole human workflow
  end-to-end: XY sketch → arbitrary-coordinate rectangle → horizontal/vertical
  constraints and the **D** distance tool → fully-constrained state → finish →
  extrude → in-place depth edit → undo/redo → save/reload → delete/restore →
  export and independently parse the STL. Feature-specific specs cover shapes,
  arcs, dimensions, constraints, free placement, and deletion.
- **Visual regression** (`part-studio-visual.spec.ts`) commits stable 1440×900
  baselines under the tracked `e2e/screenshots/` folder for the normal Part
  Studio, sketch mode with the expanded grouped toolbar, and the extrude task
  panel/live preview. To stay deterministic across GPUs/CI, the non-repeatable
  WebGL canvas is hidden (its CSS gradient shows through) so only the DOM chrome
  is diffed, while the 3D render is asserted separately by canvas pixel
  sampling. The same file asserts no overlap/overflow, readable panels, view
  cube and status presence, selected-vs-unselected body coloring, and layout at
  the minimum desktop width.
- **Agent E2E** (`apps/mcp/e2e`) spawns the real MCP stdio subprocess behind an
  MCP `Client`, drives the full sketch → constraint → solve → extrude → reload →
  export workflow (plus a slot/arc profile), and independently parses the
  exported STL bytes.

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm
test:e2e` run in that order in CI (`.github/workflows/ci.yml`) on every push
and pull request to `main`; `test:e2e` runs both the browser Playwright suite
(with a pinned Chromium) and the MCP subprocess suite, so the committed visual
baselines are part of the release gate.
