# SWALHA CAD

Browser-based parametric CAD designed for humans and AI agents.

A user (or an AI agent through MCP) creates parametric primitives, edits
their dimensions and transforms in a 3D scene, undoes/redoes changes, saves
a versioned document, and exports a printable STL mesh — the full loop from
**parameters → geometry → transforms → viewport → persistence → fabrication
export → AI control.**

## Status: Milestone 1 — Primitive-to-Print Vertical Slice

Box, cylinder, and L-bracket primitives; numeric transform editing with a
viewport gizmo; perspective/orthographic cameras; undo/redo;
`.swcad.json` save/load; binary STL export; and an MCP server exposing the
same operations to AI agents. See [Known limitations](#known-limitations)
for what's deliberately out of scope for this milestone.

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

```text
swalha-cad/
├── apps/
│   ├── web/          # React CAD interface
│   └── mcp/          # MCP stdio server
├── packages/
│   ├── document/      # versioned CAD schema + commands
│   ├── geometry/       # primitives and indexed meshes
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

```json
{
  "schemaVersion": 1,
  "units": "mm",
  "entities": [
    {
      "id": "seed-box",
      "name": "Box",
      "primitive": { "kind": "box", "width": 40, "height": 30, "depth": 20 },
      "transform": { "translation": [-60, 0, 0], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "visible": true
    },
    {
      "id": "seed-cylinder",
      "name": "Cylinder",
      "primitive": { "kind": "cylinder", "radius": 15, "height": 40, "segments": 32 },
      "transform": { "translation": [0, 0, 0], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "visible": true
    },
    {
      "id": "seed-l-bracket",
      "name": "L-Bracket",
      "primitive": { "kind": "lBracket", "width": 50, "height": 50, "depth": 20, "thickness": 8 },
      "transform": { "translation": [60, 0, 0], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "visible": true
    }
  ]
}
```

Any document is validated against this schema on load (both in the browser
and in the MCP server) — malformed or out-of-range documents are rejected
with a visible error rather than partially loaded.

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

Available tools: `create_primitive`, `list_entities`, `update_entity`,
`delete_entity`, and `export_stl` (binary STL, millimetres). Every write is
validated with Zod and applied atomically. Full tool schemas, request/response
examples, and an end-to-end walkthrough are in
[`docs/mcp.md`](./docs/mcp.md).

## Known limitations

Deliberately deferred out of Milestone 1, to keep the vertical slice small
and complete rather than broad and unfinished:

- No constraint-based 2D sketching or extrusion — primitives only.
- No boolean CSG operations.
- No text geometry, gears, fillets, or chamfers.
- No STEP/IGES import or export — STL only, and STL carries no unit
  metadata, so millimetres is a project-wide convention rather than
  something the file format enforces.
- No collaboration, accounts, or cloud persistence — documents are local
  files.
- No photorealistic materials — the viewport uses flat validation-oriented
  shading suited to reviewing geometry, not renders.
- No live browser ↔ MCP sync — the MCP server and the browser share a file,
  not a socket; reload/reopen to see the other side's changes.
- JavaScript numbers are used throughout; exact geometric predicates and
  robust boolean operations are out of scope until they're actually needed.

## Roadmap

**M2 — Constraint Sketch → Extrude:** 2D points, lines, circles, and arcs;
coincidence/horizontal/vertical/distance/radius/angle constraints;
under/fully/over-constrained status; profile detection; extrusion into
watertight solids; and matching MCP sketch/constraint tools.

## License

[MIT](./LICENSE)
