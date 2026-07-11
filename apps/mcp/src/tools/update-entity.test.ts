import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CadDocumentV1 } from '@swalha-cad/document';
import { DocumentSession } from '../document-session.js';
import { connectTestClient } from '../test/mcp-test-harness.js';
import { registerUpdateEntityTool } from './update-entity.js';

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
  dir = await mkdtemp(join(tmpdir(), 'swalha-cad-mcp-update-'));
  filePath = join(dir, 'design.swcad.json');
  await writeFile(filePath, JSON.stringify(SEED), 'utf8');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function buildServer() {
  const session = await DocumentSession.open(filePath);
  const server = new McpServer({ name: 'swalha-cad-mcp-test', version: '0.0.0' });
  registerUpdateEntityTool(server, session);
  const client = await connectTestClient(server);
  return { client, session };
}

describe('update_entity tool', () => {
  it('applies a name and translation patch through the reducer', async () => {
    const { client, session } = await buildServer();

    const result = await client.callTool({
      name: 'update_entity',
      arguments: {
        id: 'box-1',
        patch: {
          name: 'Renamed Box',
          transform: { translation: [5, 5, 5], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
        },
      },
    });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(payload.entity.name).toBe('Renamed Box');
    expect(payload.entity.transform.translation).toEqual([5, 5, 5]);
    expect(session.getDocument().entities[0]!.name).toBe('Renamed Box');
  });

  it('returns a structured error for an unknown entity id without mutating the document', async () => {
    const { client, session } = await buildServer();

    const result = await client.callTool({
      name: 'update_entity',
      arguments: { id: 'missing', patch: { name: 'Nope' } },
    });

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(payload.error.code).toBe('entity_not_found');
    expect(session.getDocument()).toEqual(SEED);
  });

  it('returns a structured error when the patch would make the primitive invalid', async () => {
    const { client, session } = await buildServer();

    const result = await client.callTool({
      name: 'update_entity',
      arguments: { id: 'box-1', patch: { primitive: { kind: 'box', width: -1, height: 10, depth: 10 } } },
    });

    expect(result.isError).toBe(true);
    expect(session.getDocument()).toEqual(SEED);
  });
});
