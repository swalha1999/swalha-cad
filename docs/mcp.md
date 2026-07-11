# MCP adapter

`apps/mcp` is a stdio [MCP](https://modelcontextprotocol.io) server that lets
an AI agent create, inspect, edit, and export a SWALHA CAD document through
the same command/reducer layer the browser UI uses (see
[`docs/architecture.md`](./architecture.md)). It never mutates the document
directly — every tool builds a `CadCommand`, re-validates it with the
document package's canonical Zod schema, and applies it through the shared
reducer, so an agent cannot create an entity the UI itself would reject.

## Document ownership

The server owns exactly one `.swcad.json` file for its process lifetime,
supplied as the first CLI argument:

```bash
pnpm --filter @swalha-cad/mcp start -- path/to/design.swcad.json
```

- If the path doesn't exist yet, an empty, schema-valid V1 document
  (`{ schemaVersion: 1, units: 'mm', entities: [] }`) is created and
  persisted before the server starts accepting requests.
- If the path exists but fails JSON parsing or schema validation, the
  server exits with a non-zero code and a structured error on stderr
  (`document_invalid_json` / `document_invalid_schema`).
- Every successful command is persisted atomically — written to a temp file
  in the same directory, then renamed over the target path — so a crash
  mid-write can never leave a corrupt or partial document on disk.

**Transport for M1 is stdio only.** There is no live browser sync: an agent
and a human editing the same file need to reload/reopen to see each other's
changes. The file-backed boundary is deliberate, so a WebSocket-based live
bridge can be added later without changing the document contract.

## Configuring an MCP client

Any MCP-compatible client that supports stdio servers can launch it
directly. For example, in a client config that takes a `command`/`args`
pair (the shape Claude Desktop, Claude Code, and similar tools use):

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

Use an absolute path for the document argument — the server resolves it
relative to its own working directory, which the client controls, not to
your shell's current directory. Running the built server directly (after
`pnpm --filter @swalha-cad/mcp build`) works the same way with `node
apps/mcp/dist/index.js /absolute/path/to/design.swcad.json` in place of the
`pnpm` invocation.

## Tools

All dimensions are millimetres; all rotations are degrees. Every tool
returns a structured error (`{ error: { code, message } }` via the MCP tool
error content) instead of throwing when validation fails, and never
partially applies a rejected command.

### `create_primitive`

Creates a box, cylinder, or L-bracket entity.

| field | type | required | notes |
| --- | --- | --- | --- |
| `primitive` | `{ kind: 'box' \| 'cylinder' \| 'lBracket', ... }` | yes | see shapes below |
| `name` | `string` | no | defaults to `"Box"` / `"Cylinder"` / `"L-Bracket"` |
| `transform` | `{ translation?, rotationDeg?, scale? }` | no | omitted fields default to identity |

Primitive shapes:

```jsonc
{ "kind": "box", "width": 40, "height": 30, "depth": 20 }
{ "kind": "cylinder", "radius": 15, "height": 40, "segments": 32 } // segments >= 3
{ "kind": "lBracket", "width": 50, "height": 50, "depth": 20, "thickness": 8 } // thickness < width and < height
```

Example call and response:

```jsonc
// call
{
  "primitive": { "kind": "box", "width": 40, "height": 30, "depth": 20 },
  "name": "Base Plate",
  "transform": { "translation": [0, 0, 0] }
}

// result
{
  "entity": {
    "id": "5c1e...",
    "name": "Base Plate",
    "primitive": { "kind": "box", "width": 40, "height": 30, "depth": 20 },
    "transform": { "translation": [0, 0, 0], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
    "visible": true
  }
}
```

### `list_entities`

No input. Returns `{ entities: CadEntity[] }`, a read-only snapshot of
every entity currently in the document.

### `update_entity`

| field | type | required | notes |
| --- | --- | --- | --- |
| `id` | `string` | yes | must match an existing entity |
| `patch` | `{ name?, visible?, primitive?, transform? }` | yes | `primitive`/`transform`, when present, replace the whole sub-object |

```jsonc
// call
{ "id": "5c1e...", "patch": { "transform": { "translation": [100, 0, 0], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] } } }

// result
{ "entity": { "id": "5c1e...", "name": "Base Plate", "primitive": { "...": "..." }, "transform": { "translation": [100, 0, 0], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] }, "visible": true } }
```

### `delete_entity`

| field | type | required |
| --- | --- | --- |
| `id` | `string` | yes |

Returns `{ deletedId: string }`. An unknown id returns a structured
`entity_not_found` error rather than a silent no-op.

### `export_stl`

No input. Bakes every *visible* entity's transform into world-space
triangles and returns a text summary plus the binary STL as a base64
embedded MCP resource:

```jsonc
{
  "content": [
    { "type": "text", "text": "Exported 160 triangles." },
    { "type": "resource", "resource": { "uri": "swalha-cad://export.stl", "mimeType": "model/stl", "blob": "<base64>" } }
  ]
}
```

Coordinates are millimetres. Hidden entities (`visible: false`) are
excluded, matching the browser's STL export.

## End-to-end example

1. Start the server against a fresh path — `design.swcad.json` is created
   automatically.
2. Call `create_primitive` three times (box, cylinder, L-bracket) to match
   the scene the browser seeds by default.
3. Call `update_entity` to move one of them.
4. Call `export_stl` and decode the base64 blob to a `.stl` file.
5. Open `design.swcad.json` in the browser (`Open` in the toolbar) to see
   the agent's changes rendered.

`apps/mcp/e2e/agent-workflow.test.ts` runs exactly this workflow against a
real stdio subprocess, including an independent STL parser that checks
triangle count and byte length — it's the executable reference for the
contract described above.
