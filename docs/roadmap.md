# Roadmap — Solid Foundation, Performance, and cad.swalha.com

This roadmap covers the path from the current Milestone 2 codebase to a
performant, publicly hosted CAD at **cad.swalha.com**, with a C++/WASM
geometry kernel behind a clean boundary.

## Where the code stands

The foundations are sound and nothing needs a rewrite: one-way package
dependencies, a pure command/reducer document layer, `buildKey`-based GPU
cache reuse in `SceneSync`, a solver that rolls back instead of
half-applying, and structured diagnostics throughout.

Four things will hurt at scale, all visible in the code today:

1. **Everything geometric runs synchronously on the UI thread.**
   `SceneSync.sync()` calls `evaluateDocument()` inline
   (`packages/renderer/src/scene-sync.ts`), and the store calls
   `solveSketch` inline on every drag candidate
   (`apps/web/src/store/cad-store.ts`). Microseconds today; frame drops
   once booleans arrive.
2. **`resolveFaceFrame` re-evaluates the whole document**
   (`packages/geometry/src/features/evaluate-document.ts`) — a pattern
   that spreads if not fenced now.
3. **`buildKey` is `JSON.stringify` of the whole sketch** — O(document
   size) hashing per body per sync — and `evaluatedWorldBounds` walks
   every vertex of every mesh on every sync.
4. **`cad-store.ts` is ~2,100 lines** and mixes document commands, tool
   sessions, solver orchestration, and UI state.

These are not bugs; they are the exact seams where the WASM kernel and
the performance work plug in. The plan is organized around them.

---

## Phase 0 — Fence the kernel boundary (pure TS, ~1–2 weeks)

Do this before writing any C++. It is the whole ballgame.

### 0.1 Define a `GeometryKernel` interface (`packages/kernel-api`)

```ts
interface GeometryKernel {
  evaluate(doc: CadDocumentV2): Promise<EvaluatedDocument>;
  solveSketch(sketch: SketchFeature, opts?: SolveOptions): Promise<SolveResult>;
  // later: boolean(op, bodyA, bodyB), fillet(...), tessellate(body, lod)
}
```

Rules that make it WASM-ready: every input/output must be
**structured-clone-safe and transferable** — meshes as
`Float32Array`/`Uint32Array` (`IndexedMesh` is already close), no
functions or class instances crossing the boundary. The current
synchronous implementation becomes `TsKernel`, the first of two
implementations and the permanent test oracle.

### 0.2 Web Worker + request coalescing

Move evaluation into a Web Worker behind the interface. During a drag,
if a new evaluate request arrives while one is in flight, drop the
queued one and keep only the latest; the UI thread renders the last
completed result. This is how a web CAD stays at 60fps while geometry
lags a frame or two behind.

### 0.3 Incremental rebuild

Replace `JSON.stringify` buildKeys with a cheap per-feature content
hash, and memoize per-feature results inside the kernel: an edit to
feature N re-runs only N and its dependents (the ordered tree plus
`sketchId` / `face.bodyId` references already define the dependency
DAG). Cache `evaluatedWorldBounds` per body.

### 0.4 Split `cad-store.ts`

Slice it into document/history, sketch session, modify tools,
selection, and viewport slices (Zustand supports slice composition
natively). Mechanical now; exponentially harder later.

### 0.5 Stable topological IDs — design now, before booleans

Formalize the face/edge ID scheme as provenance-based IDs ("cap-end
face of extrude E7", "side face swept from sketch edge L3") and write
it as a spec in `docs/`. This is the one decision that is nearly
impossible to retrofit (FreeCAD's 20-year topological-naming wound);
booleans multiply faces in ways positional IDs cannot survive.

---

## Phase 1 — The C++/WASM kernel (~3–6 weeks, parallelizable)

### 1.1 `packages/kernel-wasm`

A C++ package built with Emscripten (CMake + a Dockerized emsdk build
in CI so contributors don't need a local toolchain), exposed through
embind, implementing the same `GeometryKernel` interface. Ships behind
a feature flag; the TS kernel remains the fallback and golden-fixture
tests run against both implementations.

### 1.2 Booleans: embed Manifold, don't write our own

[Manifold](https://github.com/elalish/manifold) is a C++ library
purpose-built for guaranteed-watertight mesh booleans, fast (OpenSCAD's
new backend), and ~1MB as WASM. It provides union/subtract/intersect,
hulls, offsets, and smooth normals, and consumes exactly our indexed
triangle mesh format. This unlocks booleans in weeks instead of years.

### 1.3 Sketch solver: port only when it hurts

The current Levenberg-Marquardt solver with dense elimination is O(n³)
per iteration — fine to ~100 variables, clean and deterministic. When
sketches outgrow it, embed **planegcs** (FreeCAD's solver, LGPL,
existing WASM ports) rather than reimplementing, and keep our
structured-status layer (`under-constrained` / `conflicting`) on top.

### 1.4 Defer OCCT, keep the door open

True B-rep (fillets on solids, STEP import/export, NURBS) eventually
means opencascade.js — tens of MB of WASM and a much harder API. The
Phase 0 interface makes adopting it a third kernel implementation, not
a rewrite. Decision trigger: users asking for 3D fillets/chamfers or
STEP — not before.

### 1.5 Threads and memory discipline

Compile Manifold with pthreads and serve the site with COOP/COEP
headers so `SharedArrayBuffer` works. WASM objects are manually freed:
wrap every kernel handle in a TS class with explicit `dispose()`,
mirroring what `SceneSync` already does for GPU resources.

---

## Phase 2 — Performance as a regression gate (ongoing, ~1 week to start)

- **Budgets, enforced in CI:** sketch solve < 5ms at 200 constraints;
  full rebuild of a 50-feature document < 100ms; interaction
  (pointer→frame) < 16ms. `vitest bench` benchmarks for
  solver/extrude/boolean, plus one Playwright trace-based test that
  fails on long tasks during a scripted drag.
- **Picking:** when face/edge picking slows, add `three-mesh-bvh`
  (drop-in raycast accelerator) — no custom picking code.
- **Bundle:** lazy-load the WASM kernel
  (`WebAssembly.instantiateStreaming` + `<link rel=preload>`); the app
  is usable for sketching before the kernel finishes streaming. Target
  < 2s to interactive on a mid-range laptop, ~5MB total transfer.

---

## Phase 3 — cad.swalha.com (~1–2 weeks for v1)

No geometry servers needed — the opposite of Onshape's cost structure.

- **v1 is a static site.** Vite build + WASM assets behind the existing
  Dokploy/Traefik setup (Dockerfile with nginx or Caddy — Caddy makes
  COOP/COEP headers and TLS one-liners). Wire the domain; anyone who
  opens the URL gets the full CAD.
- **Local-first persistence:** autosave to IndexedDB/OPFS with a
  document manager UI (recent docs, rename, duplicate) alongside the
  existing `.swcad.json` open/save. Ship as a **PWA** so it installs
  and works offline — a differentiator against Onshape.
- **Sharing without accounts (v1.5):** "Copy link" storing the doc blob
  behind a tiny API (small docs may compress into the URL fragment),
  plus a read-only viewer route. Accounts, sync, and multiplayer come
  later; the command layer is already the right substrate.
- **Remote MCP (the differentiator):** expose the MCP server as a
  streamable-HTTP endpoint (e.g. `mcp.swalha.com`) operating on shared
  documents, so an agent and a human can work the same document.
- **Ship hygiene:** error reporting (Sentry or self-hosted GlitchTip on
  Dokploy), strict CSP, and a version stamp in the UI.

---

## Sequencing

Phase 0 first and alone — it is the foundation everything screws into.
Then Phase 1.1+1.2 (Manifold booleans) and Phase 3 v1 (static deploy)
run **in parallel**: deploying the current TS-kernel app to
cad.swalha.com requires nothing from the WASM work.

Realistic shape: usable public site in ~2 weeks, booleans behind a flag
in ~6, solver port and OCCT strictly on demand.
