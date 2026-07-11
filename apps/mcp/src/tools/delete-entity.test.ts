import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CadDocumentV1 } from '@swalha-cad/document';
import { DocumentSession } from '../document-session.js';
import { connectTestClient } from '../test/mcp-test-harness.js';
import { registerDeleteEntityTool } from './delete-entity.js';

let dir: string;
let filePath: string;

const SEED: CadDocumentV1 = {
  schemaVersion: 1,
  units: 'mm',
  entities: [
    {
      id: 'box-1',
      name: 'Box',
      primitive: { kind: 'box', width: 10, height: 10, depth: 10 },
      transform: { translation: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
      visible: true,
    },
  ],
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swalha-cad-mcp-delete-'));
  filePath = join(dir, 'design.swcad.json');
  await writeFile(filePath, JSON.stringify(SEED), 'utf8');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function buildServer() {
  const session = await DocumentSession.open(filePath);
  const server = new McpServer({ name: 'swalha-cad-mcp-test', version: '0.0.0' });
  registerDeleteEntityTool(server, session);
  const client = await connectTestClient(server);
  return { client, session };
}

describe('delete_entity tool', () => {
  it('removes the entity and persists the change', async () => {
    const { client, session } = await buildServer();

    const result = await client.callTool({ name: 'delete_entity', arguments: { id: 'box-1' } });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(payload.deletedId).toBe('box-1');
    expect(session.getDocument().entities).toEqual([]);
    const onDisk = JSON.parse(await readFile(filePath, 'utf8'));
    expect(onDisk.entities).toEqual([]);
  });

  it('returns a structured error for an unknown entity id without mutating the document', async () => {
    const { client, session } = await buildServer();

    const result = await client.callTool({ name: 'delete_entity', arguments: { id: 'missing' } });

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(payload.error.code).toBe('entity_not_found');
    expect(session.getDocument()).toEqual({ ...SEED, schemaVersion: 2, features: [] });
  });
});
