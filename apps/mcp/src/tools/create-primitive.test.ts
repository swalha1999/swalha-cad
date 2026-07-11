import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocumentSession } from '../document-session.js';
import { connectTestClient } from '../test/mcp-test-harness.js';
import { registerCreatePrimitiveTool } from './create-primitive.js';

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swalha-cad-mcp-create-'));
  filePath = join(dir, 'design.swcad.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function buildServer(createId?: () => string) {
  const session = await DocumentSession.open(filePath, createId ? { createId } : {});
  const server = new McpServer({ name: 'swalha-cad-mcp-test', version: '0.0.0' });
  registerCreatePrimitiveTool(server, session);
  const client = await connectTestClient(server);
  return { client, session };
}

describe('create_primitive tool', () => {
  it('creates a box with identity transform defaults and a stable injected id', async () => {
    let counter = 0;
    const { client, session } = await buildServer(() => `id-${++counter}`);

    const result = await client.callTool({
      name: 'create_primitive',
      arguments: { primitive: { kind: 'box', width: 10, height: 20, depth: 30 } },
    });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(payload.entity).toEqual({
      id: 'id-1',
      name: 'Box',
      primitive: { kind: 'box', width: 10, height: 20, depth: 30 },
      transform: { translation: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
      visible: true,
    });
    expect(session.getDocument().entities).toHaveLength(1);
  });

  it('persists the created entity to the document file', async () => {
    const { client } = await buildServer();

    await client.callTool({
      name: 'create_primitive',
      arguments: { primitive: { kind: 'cylinder', radius: 5, height: 10, segments: 16 } },
    });

    const onDisk = JSON.parse(await readFile(filePath, 'utf8'));
    expect(onDisk.entities).toHaveLength(1);
    expect(onDisk.entities[0].primitive).toEqual({ kind: 'cylinder', radius: 5, height: 10, segments: 16 });
  });

  it('honours an explicit name and transform', async () => {
    const { client } = await buildServer();

    const result = await client.callTool({
      name: 'create_primitive',
      arguments: {
        primitive: { kind: 'box', width: 1, height: 1, depth: 1 },
        name: 'My Box',
        transform: { translation: [5, 0, 0] },
      },
    });

    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(payload.entity.name).toBe('My Box');
    expect(payload.entity.transform).toEqual({ translation: [5, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] });
  });

  it('returns a structured error for a non-positive dimension without mutating the document', async () => {
    const { client, session } = await buildServer();

    const result = await client.callTool({
      name: 'create_primitive',
      arguments: { primitive: { kind: 'box', width: 0, height: 10, depth: 10 } },
    });

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(payload.error.code).toBe('invalid_primitive');
    expect(session.getDocument().entities).toHaveLength(0);
  });

  it('returns a structured error for an l-bracket whose thickness exceeds its outer dimensions', async () => {
    const { client, session } = await buildServer();

    const result = await client.callTool({
      name: 'create_primitive',
      arguments: { primitive: { kind: 'lBracket', width: 10, height: 10, depth: 10, thickness: 10 } },
    });

    expect(result.isError).toBe(true);
    expect(session.getDocument().entities).toHaveLength(0);
  });
});
