import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocumentSession } from '../document-session.js';
import { createCadMcpServer } from '../server.js';
import { connectTestClient } from '../test/mcp-test-harness.js';

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swalha-cad-mcp-entity-'));
  filePath = join(dir, 'design.swcad.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function build() {
  const session = await DocumentSession.open(filePath);
  const client = await connectTestClient(createCadMcpServer(session));
  return { client, session };
}

function payloadOf(result: CallToolResult) {
  return JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
}

async function newSketch(client: Client, plane: 'XY' | 'XZ' | 'YZ' = 'XY'): Promise<string> {
  const result = await client.callTool({ name: 'create_sketch', arguments: { plane } });
  return payloadOf(result as CallToolResult).feature.id;
}

async function addEntity(client: Client, sketchId: string, entity: unknown, construction?: boolean) {
  return (await client.callTool({
    name: 'add_sketch_entity',
    arguments: construction === undefined ? { sketchId, entity } : { sketchId, entity, construction },
  })) as CallToolResult;
}

describe('add_sketch_entity tool', () => {
  it('adds a free point', async () => {
    const { client, session } = await build();
    const sketchId = await newSketch(client);

    const result = await addEntity(client, sketchId, { type: 'point', x: 3.5, y: -2.25 });
    expect(result.isError).toBeFalsy();
    const { created, feature } = payloadOf(result);
    expect(created.points).toHaveLength(1);
    expect(feature.entities).toHaveLength(1);
    expect(feature.entities[0]).toMatchObject({ kind: 'point', x: 3.5, y: -2.25, construction: false });

    const sketch = session.getDocument().features[0] as { entities: unknown[] };
    expect(sketch.entities).toHaveLength(1);
  });

  it('adds a line, creating both endpoints as new points', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);

    const result = await addEntity(client, sketchId, { type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 4 } });
    const { created, feature } = payloadOf(result);
    expect(created.points).toHaveLength(2);
    expect(created.lines).toHaveLength(1);
    const line = feature.entities.find((entity: { kind: string }) => entity.kind === 'line');
    expect(line).toMatchObject({ startId: created.points[0], endId: created.points[1] });
  });

  it('reuses an existing point by id and merges coincident new points', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);

    const first = payloadOf(await addEntity(client, sketchId, { type: 'point', x: 0, y: 0 }));
    const originId = first.created.points[0];

    // A line starting from the existing origin point and a second line whose start
    // coincides with the first line's end should share point ids, not duplicate.
    const line = payloadOf(await addEntity(client, sketchId, { type: 'line', start: { pointId: originId }, end: { x: 10, y: 0 } }));
    expect(line.created.points).toHaveLength(1); // only the new end point
    const endId = line.created.points[0];

    const line2 = payloadOf(await addEntity(client, sketchId, { type: 'line', start: { x: 10, y: 0 }, end: { x: 10, y: 8 } }));
    expect(line2.created.points).toHaveLength(1); // start merged into endId
    const startShared = line2.feature.entities.find((e: { id: string; kind: string }) => e.kind === 'line' && e.id === line2.created.lines[0]);
    expect(startShared.startId).toBe(endId);
  });

  it('adds a corner rectangle as four points and four lines', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);

    const result = await addEntity(client, sketchId, { type: 'rectangle', corner: { x: 0, y: 0 }, opposite: { x: 20, y: 12 } });
    const { created } = payloadOf(result);
    expect(created.points).toHaveLength(4);
    expect(created.lines).toHaveLength(4);
  });

  it('adds a center-radius circle and rejects a non-positive radius as degenerate', async () => {
    const { client, session } = await build();
    const sketchId = await newSketch(client);

    const ok = payloadOf(await addEntity(client, sketchId, { type: 'circle', center: { x: 0, y: 0 }, radius: 7 }));
    expect(ok.created.circles).toHaveLength(1);

    const before = JSON.stringify(session.getDocument());
    const bad = await addEntity(client, sketchId, { type: 'circle', center: { x: 0, y: 0 }, radius: 0 });
    expect(bad.isError).toBe(true);
    expect(payloadOf(bad).error.code).toBe('degenerate_geometry');
    expect(JSON.stringify(session.getDocument())).toBe(before);
  });

  it('rejects collinear three points for a 3-point circle', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);
    const bad = await addEntity(client, sketchId, {
      type: 'circle-three-point',
      a: { x: 0, y: 0 },
      b: { x: 1, y: 1 },
      c: { x: 2, y: 2 },
    });
    expect(bad.isError).toBe(true);
    expect(payloadOf(bad).error.code).toBe('degenerate_geometry');
  });

  it('adds a three-point arc as a center point plus an arc entity', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);

    const result = await addEntity(client, sketchId, {
      type: 'arc-three-point',
      start: { x: -5, y: 0 },
      mid: { x: 0, y: 5 },
      end: { x: 5, y: 0 },
    });
    const { created, feature } = payloadOf(result);
    expect(created.points).toHaveLength(1);
    expect(created.arcs).toHaveLength(1);
    const arc = feature.entities.find((entity: { kind: string }) => entity.kind === 'arc');
    expect(arc).toMatchObject({ centerId: created.points[0], direction: expect.any(String) });
    expect(Number.isFinite(arc.radius)).toBe(true);
  });

  it('adds a straight slot as six points, two lines, and two cap arcs', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);

    const result = await addEntity(client, sketchId, { type: 'slot', centerA: { x: 0, y: 0 }, centerB: { x: 30, y: 0 }, radius: 6 });
    const { created } = payloadOf(result);
    expect(created.points).toHaveLength(6);
    expect(created.lines).toHaveLength(2);
    expect(created.arcs).toHaveLength(2);
  });

  it('adds a regular polygon with the requested number of sides', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);

    const result = await addEntity(client, sketchId, { type: 'polygon', center: { x: 0, y: 0 }, vertex: { x: 10, y: 0 }, sides: 5 });
    const { created } = payloadOf(result);
    expect(created.points).toHaveLength(5);
    expect(created.lines).toHaveLength(5);
  });

  it('marks entities as construction geometry when requested', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);
    const result = await addEntity(client, sketchId, { type: 'circle', center: { x: 0, y: 0 }, radius: 4 }, true);
    const { feature } = payloadOf(result);
    expect(feature.entities.every((entity: { construction: boolean }) => entity.construction)).toBe(true);
  });

  it('returns invalid_reference for a line referencing a missing point id', async () => {
    const { client, session } = await build();
    const sketchId = await newSketch(client);
    const bad = await addEntity(client, sketchId, { type: 'line', start: { pointId: 'nope' }, end: { x: 1, y: 1 } });
    expect(bad.isError).toBe(true);
    expect(payloadOf(bad).error.code).toBe('invalid_reference');
    expect((session.getDocument().features[0] as { entities: unknown[] }).entities).toHaveLength(0);
  });

  it('returns feature_not_found for an unknown sketch id', async () => {
    const { client } = await build();
    const bad = await addEntity(client, 'missing', { type: 'point', x: 0, y: 0 });
    expect(bad.isError).toBe(true);
    expect(payloadOf(bad).error.code).toBe('feature_not_found');
  });

  it('returns not_a_sketch when the target feature is an extrude', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);
    // Build a real closed profile so the extrude succeeds, then target it by id.
    await addEntity(client, sketchId, { type: 'rectangle', corner: { x: 0, y: 0 }, opposite: { x: 10, y: 10 } });
    const extrude = payloadOf(
      (await client.callTool({ name: 'create_or_update_extrude', arguments: { sketchId, depth: 5 } })) as CallToolResult,
    );
    const extrudeId = extrude.feature.id;

    const bad = await addEntity(client, extrudeId, { type: 'point', x: 0, y: 0 });
    expect(bad.isError).toBe(true);
    expect(payloadOf(bad).error.code).toBe('not_a_sketch');
  });

  it('persists added geometry to disk atomically', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);
    await addEntity(client, sketchId, { type: 'rectangle', corner: { x: 0, y: 0 }, opposite: { x: 8, y: 8 } });

    const onDisk = JSON.parse(await readFile(filePath, 'utf8'));
    expect(onDisk.features[0].entities).toHaveLength(8); // 4 points + 4 lines
  });
});
