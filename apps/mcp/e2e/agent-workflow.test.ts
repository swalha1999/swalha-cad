import type { CadDocumentV2 } from '@swalha-cad/document';
import { parseCadDocument } from '@swalha-cad/document';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TSX_BIN = join(PACKAGE_ROOT, 'node_modules', '.bin', 'tsx');

const HEADER_SIZE = 80;
const TRIANGLE_SIZE = 50;

interface ParsedStl {
  readonly triangleCount: number;
  readonly coordinates: readonly number[];
}

/** Independent binary STL reader for e2e verification, not reused from the exporter under test. */
function parseBinaryStl(bytes: Buffer): ParsedStl {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangleCount = view.getUint32(HEADER_SIZE, true);
  expect(bytes.byteLength).toBe(HEADER_SIZE + 4 + triangleCount * TRIANGLE_SIZE);

  const coordinates: number[] = [];
  let offset = HEADER_SIZE + 4;
  for (let i = 0; i < triangleCount; i++) {
    offset += 12; // normal
    for (let v = 0; v < 3; v++) {
      coordinates.push(view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true));
      offset += 12;
    }
    offset += 2; // attribute byte count
  }
  return { triangleCount, coordinates };
}

interface EntityPayload {
  entity: { id: string; name: string; primitive: { kind: string }; transform: { translation: number[] } };
}
interface EntitiesPayload {
  entities: EntityPayload['entity'][];
}

function jsonOf<T>(result: Record<string, unknown>): T {
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content.find((item) => item.type === 'text')?.text;
  return JSON.parse(text ?? 'null') as T;
}

let dir: string;
let documentPath: string;
let transport: StdioClientTransport;
let client: Client;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swalha-cad-mcp-e2e-'));
  documentPath = join(dir, 'design.swcad.json');

  transport = new StdioClientTransport({
    command: TSX_BIN,
    args: ['src/index.ts', documentPath],
    cwd: PACKAGE_ROOT,
    stderr: 'pipe',
  });
  client = new Client({ name: 'swalha-cad-mcp-e2e-client', version: '0.0.0' });
  await client.connect(transport);
});

afterEach(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

describe('MCP agent workflow (real stdio subprocess)', () => {
  it(
    'creates box/cylinder/L-bracket, lists and updates them, persists to disk, and exports a parseable STL',
    async () => {
      const boxResult = await client.callTool({
        name: 'create_primitive',
        arguments: { primitive: { kind: 'box', width: 40, height: 40, depth: 40 } },
      });
      const cylinderResult = await client.callTool({
        name: 'create_primitive',
        arguments: { primitive: { kind: 'cylinder', radius: 20, height: 40, segments: 32 } },
      });
      const bracketResult = await client.callTool({
        name: 'create_primitive',
        arguments: { primitive: { kind: 'lBracket', width: 50, height: 50, depth: 20, thickness: 8 } },
      });
      expect(boxResult.isError).toBeFalsy();
      expect(cylinderResult.isError).toBeFalsy();
      expect(bracketResult.isError).toBeFalsy();
      const boxId = jsonOf<EntityPayload>(boxResult).entity.id;
      const bracketId = jsonOf<EntityPayload>(bracketResult).entity.id;

      const listResult = await client.callTool({ name: 'list_entities', arguments: {} });
      const entities = jsonOf<EntitiesPayload>(listResult).entities;
      expect(entities).toHaveLength(3);
      expect(entities.map((entity) => entity.primitive.kind).sort()).toEqual(['box', 'cylinder', 'lBracket']);

      const updateResult = await client.callTool({
        name: 'update_entity',
        arguments: {
          id: bracketId,
          patch: { transform: { translation: [100, 0, -25], rotationDeg: [0, 0, 0], scale: [1, 1, 1] } },
        },
      });
      expect(updateResult.isError).toBeFalsy();
      expect(jsonOf<EntityPayload>(updateResult).entity.transform.translation).toEqual([100, 0, -25]);

      // The document is persisted to the file path supplied at startup after every command,
      // independent of the live MCP session, so it should be readable and valid on disk now.
      const persisted = parseCadDocument(JSON.parse(await readFile(documentPath, 'utf-8')) as unknown);
      expect(persisted.success).toBe(true);
      const persistedDocument = (persisted as { success: true; data: CadDocumentV2 }).data;
      expect(persistedDocument.entities).toHaveLength(3);
      const persistedBracket = persistedDocument.entities.find((entity) => entity.id === bracketId);
      expect(persistedBracket?.transform.translation).toEqual([100, 0, -25]);
      const persistedBox = persistedDocument.entities.find((entity) => entity.id === boxId);
      expect(persistedBox?.primitive).toMatchObject({ kind: 'box', width: 40 });

      const exportResult = await client.callTool({ name: 'export_stl', arguments: {} });
      expect(exportResult.isError).toBeFalsy();
      const resourceItem = (exportResult.content as Array<Record<string, unknown>>).find(
        (item) => item.type === 'resource',
      ) as { resource: { blob: string; mimeType: string } };
      expect(resourceItem.resource.mimeType).toBe('model/stl');
      const stlBytes = Buffer.from(resourceItem.resource.blob, 'base64');

      const parsed = parseBinaryStl(stlBytes);
      expect(parsed.triangleCount).toBeGreaterThan(0);
      for (const coordinate of parsed.coordinates) {
        expect(Number.isFinite(coordinate)).toBe(true);
      }
    },
    20_000,
  );
});
