import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocumentSession } from './document-session.js';
import { createCadMcpServer } from './server.js';
import { connectTestClient } from './test/mcp-test-harness.js';

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swalha-cad-mcp-server-'));
  filePath = join(dir, 'design.swcad.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface EntityPayload {
  entity: { id: string; transform: { translation: number[]; rotationDeg: number[]; scale: number[] } };
}
interface EntitiesPayload {
  entities: unknown[];
}
interface ErrorPayload {
  error: { code: string; message: string };
}

function jsonOf<T>(result: Record<string, unknown>): T {
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content.find((item) => item.type === 'text')?.text;
  return JSON.parse(text ?? 'null') as T;
}

describe('createCadMcpServer', () => {
  it('advertises the full entity, sketch, and extrude tool surface', async () => {
    let counter = 0;
    const session = await DocumentSession.open(filePath, { createId: () => `id-${++counter}` });
    const server = createCadMcpServer(session);
    const client = await connectTestClient(server);

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'add_constraint',
      'add_sketch_entity',
      'create_or_update_extrude',
      'create_primitive',
      'create_sketch',
      'delete_entity',
      'export_stl',
      'get_feature',
      'list_entities',
      'list_features',
      'solve_sketch',
      'update_entity',
    ]);
  });

  it('supports the full agent workflow: create, list, update, export, delete', async () => {
    let counter = 0;
    const session = await DocumentSession.open(filePath, { createId: () => `entity-${++counter}` });
    const server = createCadMcpServer(session);
    const client = await connectTestClient(server);

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

    const listResult = await client.callTool({ name: 'list_entities', arguments: {} });
    expect(jsonOf<EntitiesPayload>(listResult).entities).toHaveLength(3);

    const updateResult = await client.callTool({
      name: 'update_entity',
      arguments: {
        id: boxId,
        patch: { transform: { translation: [100, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] } },
      },
    });
    expect(updateResult.isError).toBeFalsy();
    expect(jsonOf<EntityPayload>(updateResult).entity.transform.translation).toEqual([100, 0, 0]);

    const exportResult = await client.callTool({ name: 'export_stl', arguments: {} });
    expect(exportResult.isError).toBeFalsy();
    const resourceItem = (exportResult.content as Array<Record<string, unknown>>).find(
      (item) => item.type === 'resource',
    ) as { resource: { blob: string } };
    const bytes = Buffer.from(resourceItem.resource.blob, 'base64');
    expect(bytes.readUInt32LE(80)).toBeGreaterThan(0);

    const deleteResult = await client.callTool({ name: 'delete_entity', arguments: { id: boxId } });
    expect(deleteResult.isError).toBeFalsy();

    const finalList = await client.callTool({ name: 'list_entities', arguments: {} });
    expect(jsonOf<EntitiesPayload>(finalList).entities).toHaveLength(2);

    const onDisk = JSON.parse(await readFile(filePath, 'utf8'));
    expect(onDisk.entities).toHaveLength(2);
  });

  it('returns a structured error result for an unknown entity id, mirrored through the client', async () => {
    const session = await DocumentSession.open(filePath);
    const server = createCadMcpServer(session);
    const client = await connectTestClient(server);

    const result = await client.callTool({ name: 'delete_entity', arguments: { id: 'does-not-exist' } });

    expect(result.isError).toBe(true);
    expect(jsonOf<ErrorPayload>(result).error.code).toBe('entity_not_found');
  });
});
