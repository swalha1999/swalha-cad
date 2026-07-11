import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CadDocumentV1 } from '@swalha-cad/document';
import { DocumentSession } from '../document-session.js';
import { connectTestClient } from '../test/mcp-test-harness.js';
import { registerListEntitiesTool } from './list-entities.js';

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swalha-cad-mcp-list-'));
  filePath = join(dir, 'design.swcad.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('list_entities tool', () => {
  it('returns an empty list for a fresh document', async () => {
    const session = await DocumentSession.open(filePath);
    const server = new McpServer({ name: 'swalha-cad-mcp-test', version: '0.0.0' });
    registerListEntitiesTool(server, session);
    const client = await connectTestClient(server);

    const result = await client.callTool({ name: 'list_entities', arguments: {} });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(payload.entities).toEqual([]);
  });

  it('returns every entity currently in the document', async () => {
    const seed: CadDocumentV1 = {
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
    await writeFile(filePath, JSON.stringify(seed), 'utf8');
    const session = await DocumentSession.open(filePath);
    const server = new McpServer({ name: 'swalha-cad-mcp-test', version: '0.0.0' });
    registerListEntitiesTool(server, session);
    const client = await connectTestClient(server);

    const result = await client.callTool({ name: 'list_entities', arguments: {} });

    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(payload.entities).toEqual(seed.entities);
  });
});
