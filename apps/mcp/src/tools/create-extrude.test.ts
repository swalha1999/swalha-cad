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
  dir = await mkdtemp(join(tmpdir(), 'swalha-cad-mcp-extrude-'));
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

async function extrude(client: Client, args: Record<string, unknown>) {
  return (await client.callTool({ name: 'create_or_update_extrude', arguments: args })) as CallToolResult;
}

async function rectangleSketch(client: Client): Promise<string> {
  const sketchId = await newSketch(client);
  await addEntity(client, sketchId, { type: 'rectangle', corner: { x: 0, y: 0 }, opposite: { x: 20, y: 10 } });
  return sketchId;
}

describe('create_or_update_extrude tool', () => {
  it('creates a normal extrude from a rectangle profile with mesh statistics', async () => {
    const { client, session } = await build();
    const sketchId = await rectangleSketch(client);

    const result = await extrude(client, { sketchId, depth: 8 });
    expect(result.isError).toBeFalsy();
    const payload = payloadOf(result);
    expect(payload.feature).toMatchObject({ kind: 'extrude', sketchId, depth: 8, direction: 'normal', name: 'Extrude 1' });
    expect(payload.mesh.triangleCount).toBeGreaterThan(0);
    expect(payload.mesh.bounds).not.toBeNull();
    expect(session.getDocument().features.filter((feature) => feature.kind === 'extrude')).toHaveLength(1);

    const onDisk = JSON.parse(await readFile(filePath, 'utf8'));
    expect(onDisk.features.some((feature: { kind: string }) => feature.kind === 'extrude')).toBe(true);
  });

  it('supports a symmetric extrude straddling the plane', async () => {
    const { client } = await build();
    const sketchId = await rectangleSketch(client);
    const result = await extrude(client, { sketchId, depth: 10, direction: 'symmetric' });
    const payload = payloadOf(result);
    expect(payload.feature.direction).toBe('symmetric');
    // Symmetric depth 10 spans -5..+5 on the plane normal (Z for an XY sketch).
    expect(payload.mesh.bounds.min[2]).toBeCloseTo(-5, 6);
    expect(payload.mesh.bounds.max[2]).toBeCloseTo(5, 6);
  });

  it('honours the reverse flag', async () => {
    const { client } = await build();
    const sketchId = await rectangleSketch(client);
    const result = await extrude(client, { sketchId, depth: 6, reverse: true });
    const payload = payloadOf(result);
    expect(payload.feature.reverse).toBe(true);
    expect(payload.mesh.bounds.min[2]).toBeCloseTo(-6, 6);
    expect(payload.mesh.bounds.max[2]).toBeCloseTo(0, 6);
  });

  it('updates an existing extrude in place when featureId is supplied', async () => {
    const { client, session } = await build();
    const sketchId = await rectangleSketch(client);
    const created = payloadOf(await extrude(client, { sketchId, depth: 8 }));
    const featureId = created.feature.id;

    const updated = await extrude(client, { sketchId, depth: 20, featureId });
    expect(updated.isError).toBeFalsy();
    const payload = payloadOf(updated);
    expect(payload.feature.id).toBe(featureId);
    expect(payload.feature.depth).toBe(20);
    expect(payload.mesh.bounds.max[2]).toBeCloseTo(20, 6);
    // Still exactly one extrude — updated, not duplicated.
    expect(session.getDocument().features.filter((feature) => feature.kind === 'extrude')).toHaveLength(1);
  });

  it('extrudes an arc/slot curve-loop profile', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);
    await addEntity(client, sketchId, { type: 'slot', centerA: { x: 0, y: 0 }, centerB: { x: 30, y: 0 }, radius: 6 });
    const result = await extrude(client, { sketchId, depth: 5 });
    expect(result.isError).toBeFalsy();
    expect(payloadOf(result).mesh.triangleCount).toBeGreaterThan(0);
  });

  it('rejects an open profile with a structured invalid_profile error and no mutation', async () => {
    const { client, session } = await build();
    const sketchId = await newSketch(client);
    await addEntity(client, sketchId, { type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });

    const before = JSON.stringify(session.getDocument());
    const result = await extrude(client, { sketchId, depth: 5 });
    expect(result.isError).toBe(true);
    expect(payloadOf(result).error.code).toBe('invalid_profile');
    expect(JSON.stringify(session.getDocument())).toBe(before);
  });

  it('rejects a non-positive depth', async () => {
    const { client } = await build();
    const sketchId = await rectangleSketch(client);
    const result = await extrude(client, { sketchId, depth: -3 });
    expect(result.isError).toBe(true);
    expect(payloadOf(result).error.code).toBe('invalid_depth');
  });

  it('returns feature_not_found for an unknown sketch id', async () => {
    const { client } = await build();
    const result = await extrude(client, { sketchId: 'missing', depth: 5 });
    expect(result.isError).toBe(true);
    expect(payloadOf(result).error.code).toBe('feature_not_found');
  });

  it('returns not_a_sketch when sketchId points at an extrude', async () => {
    const { client } = await build();
    const sketchId = await rectangleSketch(client);
    const created = payloadOf(await extrude(client, { sketchId, depth: 8 }));
    const result = await extrude(client, { sketchId: created.feature.id, depth: 5 });
    expect(result.isError).toBe(true);
    expect(payloadOf(result).error.code).toBe('not_a_sketch');
  });

  it('returns not_an_extrude when featureId points at a sketch', async () => {
    const { client } = await build();
    const sketchId = await rectangleSketch(client);
    const result = await extrude(client, { sketchId, depth: 8, featureId: sketchId });
    expect(result.isError).toBe(true);
    expect(payloadOf(result).error.code).toBe('not_an_extrude');
  });
});
