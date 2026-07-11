# Architecture

SWALHA CAD is a pnpm/TypeScript monorepo built around one rule: **the
document is the source of truth, everything else is a projection of it.**
The browser never treats a Three.js object as domain state, and the MCP
server never mutates a document directly — both go through the same
serializable command layer.

```text
apps/
├── web/          React CAD interface (Vite, Zustand, Three.js)
└── mcp/          MCP stdio server
packages/
├── document/     versioned CAD schema, commands, reducer, undo/redo history
├── geometry/     deterministic vector/matrix math and indexed-mesh primitives
├── renderer/     Three.js adapter: cameras and document → scene sync
└── export/       binary STL export
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
```

`schema.ts` mirrors these types as Zod schemas and adds the domain rules
that types alone can't express: dimensions must be strictly positive, a
cylinder needs at least 3 segments, and an L-bracket's `thickness` must be
strictly less than both its `width` and `height`. `parseCadDocument` is the
single entry point every loader (browser file open, MCP startup) runs
untrusted JSON through before it becomes a `CadDocumentV1`.

## Commands, the reducer, and undo/redo

All mutation is expressed as one of three serializable commands:

```ts
type CadCommand =
  | { type: 'entity.create'; entity: CadEntity }
  | { type: 'entity.update'; id: string; patch: CadEntityPatch }
  | { type: 'entity.delete'; id: string };
```

`reducer.ts#applyCommand` is a pure function, `(document, command) =>
document`, that throws `UnknownEntityError` for an update/delete against a
missing id and never mutates its input. `history.ts` wraps it in a
`{ past, present, future }` stack (`createHistory`, `applyCommandToHistory`,
`undo`, `redo`) so undo/redo is just history navigation, not a separate
mutation path.

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

## Renderer: document → Three.js, one-way

`packages/renderer/src/mesh-adapter.ts` wraps an `IndexedMesh`'s typed
arrays directly into a `THREE.BufferGeometry` (no copying). `camera.ts`
builds perspective and orthographic cameras. `scene-sync.ts#SceneSync` is
the only place in the codebase that owns Three.js `BufferGeometry` /
`Material` / `Mesh` instances: on every `sync(document)` call it creates,
updates in place, or disposes GPU resources to match the current document,
so GPU memory tracks the current document rather than every document state
that ever existed. Depth testing and back-face culling are enabled
explicitly, which is safe because every primitive mesh is validated to have
outward-facing winding.

## Export: baking transforms to binary STL

`packages/export/src/stl.ts#exportDocumentToBinaryStl` flattens every
*visible* entity's mesh into world-space triangles — each vertex is passed
through `transformPointBy(entity.transform, …)`, and the facet normal is
recomputed from the transformed vertices rather than reused from the mesh's
smooth per-vertex normals, since binary STL stores one normal per facet.
The result is a standard 80-byte-header / uint32-count / 50-bytes-per-facet
binary STL, treated as millimetres (STL itself carries no unit metadata,
so this is a project-wide convention rather than something the format
enforces).

## apps/web: the browser shell

Three columns — scene tree, viewport, properties panel — around a
`Toolbar` (`apps/web/src/App.tsx`). `store/cad-store.ts` is a
framework-agnostic Zustand store (`createStore` from `zustand/vanilla`) so
its logic is unit-testable without React; `store/cad-store-context.tsx`
threads it through components via context. The `Viewport` component
(`components/Viewport.tsx`, `viewport/*.ts`) owns the Three.js renderer,
orbit controls, and a transform gizmo, and calls back into the store's
`updateEntity` on drag — the gizmo never becomes the source of truth for an
entity's transform. `io/download.ts` and `io/open-document.ts` implement
`.swcad.json` save/load and STL download; opening a document re-validates it
through `parseCadDocument` and surfaces a visible error for anything
malformed rather than silently accepting it.

## apps/mcp: the same document, driven by an agent

See [`docs/mcp.md`](./mcp.md) for the full tool contract and a setup
example. In short: `DocumentSession` (`apps/mcp/src/document-session.ts`)
owns one `.swcad.json` path for the process lifetime, validates it at
startup, and persists atomically (write to a temp file, then rename) after
every applied command. `server.ts` registers five tools
(`create_primitive`, `list_entities`, `update_entity`, `delete_entity`,
`export_stl`) against that session; every tool input is a Zod schema, and
writes are re-validated as a `CadCommand` through the document package's
canonical schema before they reach the reducer, so an agent can't construct
an entity the UI itself would reject.

## Testing strategy

- **Unit tests** (Vitest) sit beside their source files in every package
  and app, covering document validation/reducer/history, geometry math and
  mesh generation, STL byte-level structure, renderer adapter behavior, and
  web store/component behavior.
- **Browser E2E** (`apps/web/e2e`, Playwright) drives the real UI in
  Chromium: add/edit/transform/undo/redo, and a save → reload → export round
  trip that parses the exported STL with an independent reader and checks
  triangle count, finite coordinates, and world bounds.
- **Agent E2E** (`apps/mcp/e2e`) spawns the real MCP stdio subprocess behind
  an MCP `Client`, drives the full create/list/update/export/delete
  workflow, and independently parses the exported STL bytes.

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm
test:e2e` run in that order in CI (`.github/workflows/ci.yml`) on every push
and pull request to `main`.
