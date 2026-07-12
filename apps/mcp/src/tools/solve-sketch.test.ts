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
  dir = await mkdtemp(join(tmpdir(), 'swalha-cad-mcp-solve-'));
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

async function addConstraint(client: Client, sketchId: string, constraint: unknown) {
  return payloadOf((await client.callTool({ name: 'add_constraint', arguments: { sketchId, constraint } })) as CallToolResult);
}

async function solve(client: Client, args: Record<string, unknown>) {
  return (await client.callTool({ name: 'solve_sketch', arguments: args })) as CallToolResult;
}

describe('solve_sketch tool', () => {
  it('reports an empty sketch as under-constrained and does not persist', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);
    const result = await solve(client, { sketchId });
    expect(result.isError).toBeFalsy();
    const payload = payloadOf(result);
    expect(payload.status).toBe('under-constrained');
    expect(payload.persisted).toBe(false);
  });

  it('reports a fully-constrained sketch and returns solver metrics', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);
    const circle = await addEntity(client, sketchId, { type: 'circle', center: { x: 0, y: 0 }, radius: 5 });
    await addConstraint(client, sketchId, { kind: 'radius', circleId: circle.created.circles[0], value: 9 });

    const result = await solve(client, { sketchId });
    const payload = payloadOf(result);
    expect(payload.status).toBe('fully-constrained');
    expect(payload.remainingDof).toBe(0);
    expect(payload.converged).toBe(true);
    expect(Number.isFinite(payload.residualNorm)).toBe(true);
  });

  it('does not persist when persist is false', async () => {
    const { client, session } = await build();
    const sketchId = await newSketch(client);
    await addEntity(client, sketchId, { type: 'line', start: { x: 0, y: 0 }, end: { x: 9, y: 0 } });
    const before = JSON.stringify(session.getDocument());

    const result = await solve(client, { sketchId, persist: false });
    expect(payloadOf(result).persisted).toBe(false);
    expect(JSON.stringify(session.getDocument())).toBe(before);
  });

  it('returns feature_not_found for an unknown sketch id', async () => {
    const { client } = await build();
    const result = await solve(client, { sketchId: 'missing' });
    expect(result.isError).toBe(true);
    expect(payloadOf(result).error.code).toBe('feature_not_found');
  });
});
