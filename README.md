# SWALHA CAD

Browser-based parametric CAD designed for humans and AI agents.

## Status

This repository is in early scaffolding. The monorepo skeleton, tooling, and CI
are in place; feature packages (document model, geometry engine, renderer,
export, web app, MCP adapter) are being built out incrementally.

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
│   ├── document/     # versioned CAD schema + commands
│   ├── geometry/      # primitives and indexed meshes
│   ├── renderer/      # Three.js adapter and camera pipeline
│   └── export/        # binary STL export
├── tests/
│   └── fixtures/       # golden CAD/STL fixtures
└── docs/                # architecture and pipeline documentation
```

## Tech stack

pnpm workspaces, TypeScript, React + Vite, Three.js, Zustand, Vitest,
Playwright, Node MCP SDK, Zod.

## Getting started

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## MCP adapter

`apps/mcp` is a stdio MCP server that owns a single `.swcad.json` file for its
process lifetime and exposes it to AI agents through the same `CadCommand`
reducer the browser UI uses. Start it against a document path:

```bash
pnpm --filter @swalha-cad/mcp start -- path/to/design.swcad.json
```

If the path does not exist yet, an empty V1 document is created and persisted
before the server starts accepting requests. Available tools: `create_primitive`,
`list_entities`, `update_entity`, `delete_entity`, and `export_stl` (binary STL,
millimetres). Every write is validated with Zod and applied atomically.

## License

[MIT](./LICENSE)
