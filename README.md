# SWALHA CAD

Browser-based parametric CAD designed for humans and AI agents.

A user (or an AI agent through MCP) works in an Onshape-inspired Part Studio:
they place parametric primitives, or draw a constrained 2D sketch on an origin
plane and extrude a closed profile into a watertight solid. They edit
dimensions and depths and watch the model rebuild deterministically, undo/redo
and delete/restore, save a versioned document, and export a printable STL mesh
— the full loop from **sketch → constraints → profile → extrusion → geometry →
viewport → persistence → fabrication export → AI control.**

## Status: Milestone 2 — Constraint Sketch → Extrude

Everything from Milestone 1 (box/cylinder/L-bracket primitives, numeric
transform editing, perspective/orthographic cameras, undo/redo, `.swcad.json`
save/load, binary STL export, and an MCP server) plus a full 2D-sketch-to-3D
workflow:

- **Onshape-inspired Part Studio shell** — a dense two-level toolbar, left
  feature tree, contextual right panel, view cube / axis triad / navigation
  overlays, resizable panels, and a bottom Part Studio/status strip.
- **Constraint sketching** on the XY/XZ/YZ origin planes with points, lines,
  circles, and arcs, plus higher-level tools (corner/center/3-point rectangle,
  center/3-point/tangent arc, slot, polygon) that decompose into those
  entities.
- **Free-coordinate canvas** — geometry is placed at continuous floating-point
  coordinates and never quantized to the grid. Grid display and each snap type
  (grid, endpoint, center, origin, …) are independent opt-in toggles;
  dimensions and constraints, not the grid, define final geometry.
- **A scoped geometric solver** for coincidence, horizontal, vertical,
  distance, radius, and angle constraints, with under-constrained /
  fully-constrained / conflicting status feedback and a keyboard-first **D**
  distance/dimension tool.
- **Watertight extrusion** of a closed profile (one outer loop or one circle)
  with normal or symmetric direction, live depth preview, in-place depth
  editing, and deterministic rebuild through the renderer and STL export.
- **Onshape-style deletion** — unified selection, dependency-aware cascade with
  a confirmation of impact, and reversible via undo.
- **MCP parity** — agents drive the same sketch/constraint/solve/extrude
  operations through commands, never touching state directly.

See [Known limitations](#known-limitations) for what remains deliberately out
of scope.

## Quick start

Requires Node.js `>=22.13` (matching this repo's `pnpm@11.8.0` requirement)
and pnpm.

```bash
pnpm install
pnpm dev            # starts apps/web on http://localhost:5173
```

To run the full release gate locally:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e        # installs/uses a Chromium browser via Playwright
```

## Architecture

A TypeScript monorepo separates the canonical CAD document model and
deterministic geometry engine from the browser renderer and MCP adapter. The
browser is a projection of the document, never the source of truth.

The interaction model is **inspired by Onshape** — its information
architecture, density, and Part Studio flow — without copying its branding or
proprietary assets. The property/solver design deliberately **learns from
FreeCAD's lessons**: features are parametric and rebuild from an ordered tree,
but the M2 solver is a small, explicitly scoped constraint set with
deterministic tolerances and structured conflict reporting rather than a claim
of full industrial-solver parity, which keeps failures legible instead of
silently mis-solving.

```text
swalha-cad/
├── apps/
│   ├── web/          # React CAD interface
│   └── mcp/          # MCP stdio server
├── packages/
│   ├── document/      # versioned CAD schema (V1+V2) + commands + migration
│   ├── geometry/       # primitives, sketch solver/profile, extrusion, meshes
│   ├── renderer/        # Three.js adapter and camera pipeline
│   └── export/           # binary STL export
├── tests/
│   └── fixtures/           # golden CAD/STL fixtures
└── docs/                     # architecture and pipeline documentation
```

- [`docs/architecture.md`](./docs/architecture.md) — how the document
  model, command/reducer/history layer, geometry, renderer, and export
  packages fit together, and how the web app and MCP server both sit on top
  of the same layer.
- [`docs/graphics-pipeline.md`](./docs/graphics-pipeline.md) — the
  model → world → camera → projection → viewport pipeline, mapped onto the
  concrete types in `packages/geometry` and `packages/renderer`.
- [`docs/mcp.md`](./docs/mcp.md) — MCP setup and the full tool contract.

## Tech stack

pnpm workspaces, TypeScript, React + Vite, Three.js, Zustand, Vitest,
Playwright, Node MCP SDK, Zod.

## Supported primitives

All dimensions are millimetres.

| Primitive | Parameters | Notes |
| --- | --- | --- |
| Box | `width`, `height`, `depth` | all strictly positive |
| Cylinder | `radius`, `height`, `segments` | `segments >= 3` |
| L-bracket | `width`, `height`, `depth`, `thickness` | watertight extruded profile; `thickness` strictly less than both `width` and `height` |

Every entity also has a `name`, a `transform` (`translation`, `rotationDeg`,
`scale`, each an `[x, y, z]` tuple), and `visible`. Transforms compose as
scale → rotate (Z·Y·X) → translate.

## `.swcad.json` example

A document is a schema-versioned union. **V2** adds a `features` array of
sketches and extrusions alongside the retained M1 primitive `entities`:

```json
{
  "schemaVersion": 2,
  "units": "mm",
  "entities": [
    {
      "id": "seed-box",
      "name": "Box",
      "primitive": { "kind": "box", "width": 40, "height": 30, "depth": 20 },
      "transform": { "translation": [-60, 0, 0], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "visible": true
    }
  ],
  "features": [
    {
      "id": "sketch-1",
      "kind": "sketch",
      "name": "Sketch 1",
      "plane": "XY",
      "entities": [
        { "id": "p0", "kind": "point", "x": 0, "y": 0, "construction": false },
        { "id": "p1", "kind": "point", "x": 60, "y": 0, "construction": false },
        { "id": "p2", "kind": "point", "x": 60, "y": 35, "construction": false },
        { "id": "p3", "kind": "point", "x": 0, "y": 35, "construction": false },
        { "id": "l0", "kind": "line", "startId": "p0", "endId": "p1", "construction": false },
        { "id": "l1", "kind": "line", "startId": "p1", "endId": "p2", "construction": false },
        { "id": "l2", "kind": "line", "startId": "p2", "endId": "p3", "construction": false },
        { "id": "l3", "kind": "line", "startId": "p3", "endId": "p0", "construction": false }
      ],
      "constraints": [
        { "id": "c0", "kind": "horizontal", "lineId": "l0" },
        { "id": "c1", "kind": "vertical", "lineId": "l1" },
        { "id": "c2", "kind": "distance", "pointA": "p0", "pointB": "p1", "value": 60 },
        { "id": "c3", "kind": "distance", "pointA": "p1", "pointB": "p2", "value": 35 }
      ],
      "visible": true
    },
    {
      "id": "extrude-1",
      "kind": "extrude",
      "name": "Extrude 1",
      "sketchId": "sketch-1",
      "depth": 40,
      "direction": "normal",
      "visible": true
    }
  ]
}
```

**V1 files still load:** they are migrated in memory to V2 by adding an empty
`features: []`, and every save emits V2. Sketch entities are `point`, `line`,
`circle`, and `arc`; constraints are `coincident`, `horizontal`, `vertical`,
`distance`, `radius`, and `angle`; an extrude references its `sketchId` with a
`depth` and `normal`/`symmetric` `direction`.

Any document is validated against this schema on load (both in the browser and
in the MCP server) — malformed documents, out-of-range dimensions, and broken
feature references are rejected with a visible error rather than partially
loaded.

## MCP adapter

`apps/mcp` is a stdio MCP server that owns a single `.swcad.json` file for
its process lifetime and exposes it to AI agents through the same
`CadCommand` reducer the browser UI uses. Start it against a document path:

```bash
pnpm --filter @swalha-cad/mcp start -- path/to/design.swcad.json
```

Example client config (stdio):

```json
{
  "mcpServers": {
    "swalha-cad": {
      "command": "pnpm",
      "args": ["--filter", "@swalha-cad/mcp", "start", "--", "/absolute/path/to/design.swcad.json"]
    }
  }
}
```

Available tools: the M1 primitive set (`create_primitive`, `list_entities`,
`update_entity`, `delete_entity`, `export_stl`) plus the M2 sketch/extrude set
(`create_sketch`, `add_sketch_entity`, `add_constraint`, `solve_sketch`,
`create_or_update_extrude`, `list_features`, `get_feature`). Every write is
validated with Zod, applied through the same `CadCommand` reducer the UI uses,
and persisted atomically; topology and solver failures come back as structured
errors. Full tool schemas, request/response examples, and an end-to-end
sketch → extrude walkthrough are in [`docs/mcp.md`](./docs/mcp.md).

## Known limitations

Stated honestly — these are deliberately out of scope so the sketch-to-solid
slice is complete rather than broad and unfinished:

- **Solver scope.** The constraint solver handles only the six supported
  constraints on the supported entities, with deterministic tolerances and
  bounded iterations. It is not a general nonlinear industrial solver and does
  no exhaustive degrees-of-freedom analysis; contradictory systems are reported
  as `conflicting` rather than partially applied.
- **One profile per extrusion.** Extrusion supports a single simple outer loop
  or one circle — no holes, no multiple regions. Ambiguous or self-intersecting
  profiles are rejected with a diagnostic, not silently guessed.
- **No booleans between solids.** Union/subtract/intersect between arbitrary
  bodies is not implemented; extrusions and primitives coexist but do not
  combine.
- **Sketching is on origin planes only** (XY/XZ/YZ) — no sketching on an
  existing solid's face, and no splines, trim/extend, fillet, or chamfer.
- **No STEP/IGES/BREP/NURBS.** STL export only, and STL carries no unit
  metadata, so millimetres is a project-wide convention rather than something
  the file format enforces.
- **No collaboration, accounts, or cloud persistence** — documents are local
  files, and there is **no live browser ↔ MCP sync**: the two share a file, not
  a socket, so reload/reopen to see the other side's changes.
- **Validation-oriented shading**, not photorealistic materials; the viewport
  favors reviewing geometry over renders.
- JavaScript numbers are used throughout; exact geometric predicates and robust
  boolean operations are out of scope until they're actually needed.

## Roadmap

Milestone 2 (constraint sketch → extrude) is complete. Likely next steps,
building on the same document-is-truth foundation:

**M3 candidates:** sketching on solid faces; boolean union/subtract/intersect;
holes and multiple regions in one extrusion; additional features (revolve,
fillet/chamfer); and a broadened constraint set with fuller
degrees-of-freedom analysis.

## License

[MIT](./LICENSE)
