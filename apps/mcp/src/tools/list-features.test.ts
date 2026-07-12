import { mkdtemp, rm } from 'node:fs/promises';
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
  dir = await mkdtemp(join(tmpdir(), 'swalha-cad-mcp-features-'));
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

async function newSketch(client: Client): Promise<string> {
  return payloadOf((await client.callTool({ name: 'create_sketch', arguments: { plane: 'XY' } })) as CallToolResult).feature.id;
}

async function addEntity(client: Client, sketchId: string, entity: unknown) {
  return payloadOf((await client.callTool({ name: 'add_sketch_entity', arguments: { sketchId, entity } })) as CallToolResult);
}

describe('list_features tool', () => {
  it('summarizes sketches and extrudes with stable ids', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);
    await addEntity(client, sketchId, { type: 'rectangle', corner: { x: 0, y: 0 }, opposite: { x: 10, y: 6 } });
    const extrude = payloadOf(
      (await client.callTool({ name: 'create_or_update_extrude', arguments: { sketchId, depth: 4 } })) as CallToolResult,
    );

    const list = payloadOf((await client.callTool({ name: 'list_features', arguments: {} })) as CallToolResult);
    expect(list.features).toHaveLength(2);
    const sketchRow = list.features.find((row: { kind: string }) => row.kind === 'sketch');
    const extrudeRow = list.features.find((row: { kind: string }) => row.kind === 'extrude');
    expect(sketchRow).toMatchObject({ id: sketchId, plane: 'XY', entityCount: 8, constraintCount: 0 });
    expect(extrudeRow).toMatchObject({ id: extrude.feature.id, sketchId, depth: 4, direction: 'normal' });
  });
});

describe('get_feature tool', () => {
  it('reports a closed sketch profile and solve status', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);
    await addEntity(client, sketchId, { type: 'rectangle', corner: { x: 0, y: 0 }, opposite: { x: 10, y: 6 } });

    const result = payloadOf((await client.callTool({ name: 'get_feature', arguments: { id: sketchId } })) as CallToolResult);
    expect(result.feature.kind).toBe('sketch');
    expect(result.profile.ok).toBe(true);
    expect(result.profile.profile.kind).toBe('line-loop');
    expect(result.solve.status).toBeDefined();
  });

  it('reports topology issues for an open sketch profile', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);
    // A single open line is not a closed profile.
    await addEntity(client, sketchId, { type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });

    const result = payloadOf((await client.callTool({ name: 'get_feature', arguments: { id: sketchId } })) as CallToolResult);
    expect(result.profile.ok).toBe(false);
    expect(result.profile.issues.length).toBeGreaterThan(0);
  });

  it('reports extrude mesh statistics', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);
    await addEntity(client, sketchId, { type: 'circle', center: { x: 0, y: 0 }, radius: 5 });
    const extrude = payloadOf(
      (await client.callTool({ name: 'create_or_update_extrude', arguments: { sketchId, depth: 10 } })) as CallToolResult,
    );

    const result = payloadOf((await client.callTool({ name: 'get_feature', arguments: { id: extrude.feature.id } })) as CallToolResult);
    expect(result.feature.kind).toBe('extrude');
    expect(result.evaluation.built).toBe(true);
    expect(result.evaluation.triangleCount).toBeGreaterThan(0);
    expect(result.evaluation.bounds).not.toBeNull();
  });

  it('returns feature_not_found for an unknown id', async () => {
    const { client } = await build();
    const result = (await client.callTool({ name: 'get_feature', arguments: { id: 'missing' } })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(payloadOf(result).error.code).toBe('feature_not_found');
  });
});
