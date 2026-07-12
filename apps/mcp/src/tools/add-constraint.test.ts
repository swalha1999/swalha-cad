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
  dir = await mkdtemp(join(tmpdir(), 'swalha-cad-mcp-constraint-'));
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
  return (await client.callTool({ name: 'add_constraint', arguments: { sketchId, constraint } })) as CallToolResult;
}

describe('add_constraint tool', () => {
  it('applies horizontal + distance to fully constrain a line and adopts the solved geometry', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);
    // Line slightly short of 10mm so the distance constraint must move the free end.
    const line = await addEntity(client, sketchId, { type: 'line', start: { x: 0, y: 0 }, end: { x: 9, y: 0 } });
    const [a, b] = line.created.points as [string, string];
    const lineId = line.created.lines[0] as string;

    const horizontal = await addConstraint(client, sketchId, { kind: 'horizontal', lineId });
    expect(horizontal.isError).toBeFalsy();
    expect(payloadOf(horizontal).solve.status).toBe('under-constrained');

    const distance = await addConstraint(client, sketchId, { kind: 'distance', pointA: a, pointB: b, value: 10 });
    expect(distance.isError).toBeFalsy();
    const result = payloadOf(distance);
    expect(result.solve.status).toBe('fully-constrained');
    expect(result.solve.remainingDof).toBe(0);
    const movedEnd = result.feature.entities.find((entity: { id: string }) => entity.id === b);
    expect(movedEnd.x).toBeCloseTo(10, 6);
    expect(movedEnd.y).toBeCloseTo(0, 6);
  });

  it('fully constrains a circle with a radius constraint', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);
    const circle = await addEntity(client, sketchId, { type: 'circle', center: { x: 0, y: 0 }, radius: 5 });
    const circleId = circle.created.circles[0] as string;

    const result = await addConstraint(client, sketchId, { kind: 'radius', circleId, value: 12 });
    expect(result.isError).toBeFalsy();
    const payload = payloadOf(result);
    expect(payload.solve.status).toBe('fully-constrained');
    const solvedCircle = payload.feature.entities.find((entity: { id: string }) => entity.id === circleId);
    expect(solvedCircle.radius).toBeCloseTo(12, 6);
  });

  it('applies vertical and coincident constraints', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);
    const line = await addEntity(client, sketchId, { type: 'line', start: { x: 0, y: 0 }, end: { x: 0.2, y: 8 } });
    const lineId = line.created.lines[0] as string;
    const vertical = await addConstraint(client, sketchId, { kind: 'vertical', lineId });
    expect(vertical.isError).toBeFalsy();
    expect(['under-constrained', 'fully-constrained']).toContain(payloadOf(vertical).solve.status);

    const p = await addEntity(client, sketchId, { type: 'point', x: 40, y: 40 });
    const stray = p.created.points[0] as string;
    const [a] = line.created.points as [string, string];
    const coincident = await addConstraint(client, sketchId, { kind: 'coincident', pointA: stray, pointB: a });
    expect(coincident.isError).toBeFalsy();
  });

  it('applies an angle constraint between two lines', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);
    const l1 = await addEntity(client, sketchId, { type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    const l2 = await addEntity(client, sketchId, { type: 'line', start: { x: 0, y: 0 }, end: { x: 0, y: 10 } });
    const result = await addConstraint(client, sketchId, {
      kind: 'angle',
      lineA: l1.created.lines[0],
      lineB: l2.created.lines[0],
      valueDeg: 90,
    });
    expect(result.isError).toBeFalsy();
  });

  it('rejects contradictory distance constraints with a solver_conflict error and no mutation', async () => {
    const { client, session } = await build();
    const sketchId = await newSketch(client);
    const line = await addEntity(client, sketchId, { type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    const [a, b] = line.created.points as [string, string];

    await addConstraint(client, sketchId, { kind: 'distance', pointA: a, pointB: b, value: 10 });
    const before = JSON.stringify(session.getDocument());
    const conflict = await addConstraint(client, sketchId, { kind: 'distance', pointA: a, pointB: b, value: 25 });

    expect(conflict.isError).toBe(true);
    expect(payloadOf(conflict).error.code).toBe('solver_conflict');
    expect(JSON.stringify(session.getDocument())).toBe(before);
  });

  it('rejects a constraint referencing a missing point with invalid_constraint', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);
    const p = await addEntity(client, sketchId, { type: 'point', x: 0, y: 0 });
    const a = p.created.points[0] as string;
    const bad = await addConstraint(client, sketchId, { kind: 'distance', pointA: a, pointB: 'ghost', value: 5 });
    expect(bad.isError).toBe(true);
    expect(payloadOf(bad).error.code).toBe('invalid_constraint');
  });

  it('rejects a non-positive dimension with invalid_constraint', async () => {
    const { client } = await build();
    const sketchId = await newSketch(client);
    const line = await addEntity(client, sketchId, { type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    const [a, b] = line.created.points as [string, string];
    const bad = await addConstraint(client, sketchId, { kind: 'distance', pointA: a, pointB: b, value: -5 });
    expect(bad.isError).toBe(true);
    expect(payloadOf(bad).error.code).toBe('invalid_constraint');
  });

  it('returns feature_not_found for an unknown sketch id', async () => {
    const { client } = await build();
    const bad = await addConstraint(client, 'missing', { kind: 'horizontal', lineId: 'x' });
    expect(bad.isError).toBe(true);
    expect(payloadOf(bad).error.code).toBe('feature_not_found');
  });
});
