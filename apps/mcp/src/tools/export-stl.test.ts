import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CadDocumentV1 } from '@swalha-cad/document';
import { DocumentSession } from '../document-session.js';
import { connectTestClient } from '../test/mcp-test-harness.js';
import { registerExportStlTool } from './export-stl.js';

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
    {
      id: 'hidden-box',
      name: 'Hidden Box',
      primitive: { kind: 'box', width: 5, height: 5, depth: 5 },
      transform: { translation: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
      visible: false,
    },
  ],
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swalha-cad-mcp-export-'));
  filePath = join(dir, 'design.swcad.json');
  await writeFile(filePath, JSON.stringify(SEED), 'utf8');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('export_stl tool', () => {
  it('returns a binary STL resource with the visible box triangulated', async () => {
    const session = await DocumentSession.open(filePath);
    const server = new McpServer({ name: 'swalha-cad-mcp-test', version: '0.0.0' });
    registerExportStlTool(server, session);
    const client = await connectTestClient(server);

    const result = await client.callTool({ name: 'export_stl', arguments: {} });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<Record<string, unknown>>;
    const resourceItem = content.find((item) => item.type === 'resource') as
      | { resource: { mimeType?: string; blob: string; uri: string } }
      | undefined;
    expect(resourceItem).toBeDefined();
    expect(resourceItem!.resource.mimeType).toBe('model/stl');

    const bytes = Buffer.from(resourceItem!.resource.blob, 'base64');
    expect(bytes.byteLength).toBeGreaterThan(84);
    const triangleCount = bytes.readUInt32LE(80);
    // A box triangulates to 12 triangles; the hidden box must be excluded.
    expect(triangleCount).toBe(12);
  });
});
