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

- If the path doesn't exist yet, an empty, schema-valid V2 document
  (`{ schemaVersion: 2, units: 'mm', entities: [], features: [] }`) is
  created and persisted before the server starts accepting requests. A
  pre-existing V1 document is migrated to V2 in memory on load and saved as
  V2 after the first command.
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
excluded, matching the browser's STL export. The exported solids include
both the retained M1 primitive entities **and** the meshes derived from
visible extrude features (see the sketch/extrude tools below).

## Sketch and extrude tools

These expose the same M2 sketch → constraint → extrude pipeline the browser
uses. A sketch feature holds 2D entities and constraints on an origin plane;
an extrude feature sweeps a sketch's single closed profile into a solid. All
sketch coordinates are plane-local millimetres; angles supplied to the
constraint solver are degrees, while raw `arc` angles are radians (matching
the document model). Every tool builds a `CadCommand`, re-validates the whole
prospective document with the canonical schema before persisting, and returns
a structured error (never partially applying) on failure.

Common error codes: `feature_not_found`, `not_a_sketch`, `not_an_extrude`,
`invalid_reference` (a point id that doesn't resolve), `degenerate_geometry`
(collinear/zero-size input), `invalid_constraint`, `solver_conflict`,
`invalid_profile` / `invalid_depth` / `degenerate_profile` (extrude),
`invalid_document` (final schema validation).

### `create_sketch`

Creates an empty sketch on an origin plane.

| field | type | required | notes |
| --- | --- | --- | --- |
| `plane` | `'XY' \| 'XZ' \| 'YZ'` | yes | origin plane |
| `name` | `string` | no | defaults to `"Sketch N"` |

Returns `{ feature: SketchFeature }`. Add geometry with `add_sketch_entity`
using the returned `feature.id`.

### `add_sketch_entity`

Appends one entity — simple or compound — to a sketch. New points that
coincide (within 1e-6) with an existing point or one created earlier in the
same call are merged, so shared corners/joints become coincident by id.

| field | type | required | notes |
| --- | --- | --- | --- |
| `sketchId` | `string` | yes | target sketch |
| `entity` | tagged object (see below) | yes | discriminated by `type` |
| `construction` | `boolean` | no | mark created entities as construction geometry (default `false`) |

A **point reference** (`PointRef`) is either `{ "pointId": "..." }` (reuse an
existing point) or `{ "x": number, "y": number }` (place/merge a new point).
Compound-form coordinate fields (`a`/`b`/`c`, `start`/`mid`/`end`,
`center`/`through`) are plain `{ x, y }` pairs.

`entity` variants by `type`:

```jsonc
{ "type": "point", "x": 3.5, "y": -2.25 }
{ "type": "line", "start": PointRef, "end": PointRef }
{ "type": "circle", "center": PointRef, "radius": 7 }              // radius > 0
{ "type": "circle-three-point", "a": {x,y}, "b": {x,y}, "c": {x,y} }
{ "type": "arc", "center": PointRef, "radius": 5,                  // angles in radians
  "startAngle": 0, "endAngle": 3.14159, "direction": "ccw" | "cw" }
{ "type": "arc-three-point", "start": {x,y}, "mid": {x,y}, "end": {x,y} }
{ "type": "arc-center-point", "center": {x,y}, "start": {x,y}, "through": {x,y} }
{ "type": "arc-tangent", "start": {x,y}, "tangent": [dx,dy], "end": {x,y} }
{ "type": "rectangle", "corner": PointRef, "opposite": PointRef }  // two opposite corners
{ "type": "center-rectangle", "center": PointRef, "corner": PointRef }
{ "type": "three-point-rectangle", "a": PointRef, "b": PointRef, "third": PointRef }
{ "type": "polygon", "center": PointRef, "vertex": PointRef, "sides": 6 } // sides >= 3
{ "type": "slot", "centerA": PointRef, "centerB": PointRef, "radius": 6 }  // radius > 0
```

Returns `{ feature: SketchFeature, created: { points, lines, circles, arcs } }`
where each `created.*` is the list of new entity ids (use them for
constraints). A degenerate/collinear input returns `degenerate_geometry`; a
dangling `pointId` returns `invalid_reference`.

### `add_constraint`

Adds one constraint and re-solves the sketch (grounded on its first point),
adopting the solved geometry when the solve succeeds.

| field | type | required |
| --- | --- | --- |
| `sketchId` | `string` | yes |
| `constraint` | tagged object (see below) | yes |

`constraint` variants by `kind`:

```jsonc
{ "kind": "coincident", "pointA": "id", "pointB": "id" }
{ "kind": "horizontal", "lineId": "id" }
{ "kind": "vertical", "lineId": "id" }
{ "kind": "distance", "pointA": "id", "pointB": "id", "value": 40 }   // value > 0 (mm)
{ "kind": "radius", "circleId": "id", "value": 12 }                   // value > 0 (mm)
{ "kind": "angle", "lineA": "id", "lineB": "id", "valueDeg": 90 }     // 0 < deg < 180
```

Returns `{ feature, constraint, solve: { status, remainingDof, diagnostics } }`
with `status` one of `under-constrained` / `fully-constrained`. An invalid
reference or out-of-range dimension returns `invalid_constraint`; a
contradictory constraint set returns `solver_conflict` and does **not** persist.

### `solve_sketch`

| field | type | required | notes |
| --- | --- | --- | --- |
| `sketchId` | `string` | yes | |
| `persist` | `boolean` | no | write the solved geometry back (default `true`; skipped for a conflicting/invalid solve) |

Returns `{ sketchId, status, remainingDof, converged, iterations,
residualNorm, diagnostics, persisted }` where `status` is
`under-constrained` / `fully-constrained` / `conflicting` / `invalid`.

### `create_or_update_extrude`

Sweeps a sketch's single closed profile into a solid.

| field | type | required | notes |
| --- | --- | --- | --- |
| `sketchId` | `string` | yes | must resolve to one extrudable profile |
| `depth` | `number` | yes | > 0 (mm) |
| `direction` | `'normal' \| 'symmetric'` | no | default `normal` |
| `reverse` | `boolean` | no | flip a `normal` sweep (ignored for `symmetric`) |
| `name` | `string` | no | new extrude only; defaults to `"Extrude N"` |
| `featureId` | `string` | no | update this existing extrude instead of creating one |

Returns `{ feature: ExtrudeFeature, mesh: { triangleCount, vertexCount,
bounds } }`. An open/ambiguous/self-intersecting profile returns
`invalid_profile` (with the topology issues in the message); a non-positive
depth returns `invalid_depth`. Neither mutates the document.

### `list_features`

No input. Returns `{ features: [...] }`, a compact summary row per feature
(`{ id, kind, name, ... }`) so an agent can obtain stable ids.

### `get_feature`

| field | type | required |
| --- | --- | --- |
| `id` | `string` | yes |

Returns the full feature plus diagnostics: for a **sketch**, `{ feature,
solve: { status, remainingDof, diagnostics }, profile }` where `profile` is
`{ ok: true, profile }` for a detected profile or `{ ok: false, issues }`
listing the topology problems; for an **extrude**, `{ feature, evaluation: {
built, triangleCount, vertexCount, bounds, diagnostic } }`.

## Sketch → extrude agent example

Build a fully-dimensioned rectangle on the XZ plane and extrude it
symmetrically:

```jsonc
// 1. create_sketch
{ "plane": "XZ" }
// → { "feature": { "id": "sk", "kind": "sketch", "plane": "XZ", ... } }

// 2. add_sketch_entity (corner rectangle → 4 points + 4 lines)
{ "sketchId": "sk", "entity": { "type": "rectangle", "corner": { "x": 3.3, "y": 2.1 }, "opposite": { "x": 43.3, "y": 27.1 } } }
// → { "feature": {...}, "created": { "points": ["p0","p1","p2","p3"], "lines": ["l0","l1","l2","l3"], "circles": [], "arcs": [] } }

// 3. add_constraint (bottom edge horizontal)
{ "sketchId": "sk", "constraint": { "kind": "horizontal", "lineId": "l0" } }
// 4. add_constraint (right edge vertical)
{ "sketchId": "sk", "constraint": { "kind": "vertical", "lineId": "l1" } }
// 5. add_constraint (width dimension)
{ "sketchId": "sk", "constraint": { "kind": "distance", "pointA": "p0", "pointB": "p1", "value": 40 } }
// 6. add_constraint (height dimension)
{ "sketchId": "sk", "constraint": { "kind": "distance", "pointA": "p1", "pointB": "p2", "value": 25 } }
//    → each returns solve: { status: "under-constrained" | "fully-constrained", ... }

// 7. solve_sketch (optional explicit solve/status check)
{ "sketchId": "sk" }
// → { "status": "under-constrained", "remainingDof": 2, "persisted": true, ... }

// 8. create_or_update_extrude (symmetric solid)
{ "sketchId": "sk", "depth": 12.5, "direction": "symmetric" }
// → { "feature": { "id": "ex", "kind": "extrude", ... }, "mesh": { "triangleCount": 12, ... } }

// 9. export_stl → base64 binary STL of the resulting solid
{}
```

`apps/mcp/e2e/sketch-extrude-workflow.test.ts` runs exactly this workflow
(plus a slot/arc profile) against a real stdio subprocess, reloads the
document from disk in a second process, and parses the exported STL — it's
the executable reference for the contract above.

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
