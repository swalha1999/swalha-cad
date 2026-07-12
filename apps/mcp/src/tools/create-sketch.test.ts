import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocumentSession } from '../document-session.js';
import { createCadMcpServer } from '../server.js';
import { connectTestClient } from '../test/mcp-test-harness.js';

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swalha-cad-mcp-sketch-'));
  filePath = join(dir, 'design.swcad.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function build(createId?: () => string) {
  const session = await DocumentSession.open(filePath, createId ? { createId } : {});
  const client = await connectTestClient(createCadMcpServer(session));
  return { client, session };
}

function payloadOf(result: Awaited<ReturnType<Awaited<ReturnType<typeof build>>['client']['callTool']>>) {
  return JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
}

describe('create_sketch tool', () => {
  it('creates an empty XY sketch with a default name and stable id, persisted to disk', async () => {
    let counter = 0;
    const { client, session } = await build(() => `id-${++counter}`);

    const result = await client.callTool({ name: 'create_sketch', arguments: { plane: 'XY' } });

    expect(result.isError).toBeFalsy();
    const { feature } = payloadOf(result);
    expect(feature).toEqual({
      id: 'id-1',
      kind: 'sketch',
      name: 'Sketch 1',
      plane: 'XY',
      entities: [],
      constraints: [],
      visible: true,
    });
    expect(session.getDocument().features).toHaveLength(1);

    const onDisk = JSON.parse(await readFile(filePath, 'utf8'));
    expect(onDisk.features).toHaveLength(1);
    expect(onDisk.features[0].plane).toBe('XY');
  });

  it('creates sketches on the XZ and YZ planes and uniquifies default names', async () => {
    const { client } = await build();

    const xz = payloadOf(await client.callTool({ name: 'create_sketch', arguments: { plane: 'XZ' } }));
    const yz = payloadOf(await client.callTool({ name: 'create_sketch', arguments: { plane: 'YZ' } }));

    expect(xz.feature.plane).toBe('XZ');
    expect(xz.feature.name).toBe('Sketch 1');
    expect(yz.feature.plane).toBe('YZ');
    expect(yz.feature.name).toBe('Sketch 2');
  });

  it('honours an explicit name', async () => {
    const { client } = await build();
    const result = await client.callTool({ name: 'create_sketch', arguments: { plane: 'XY', name: 'Base Profile' } });
    expect(payloadOf(result).feature.name).toBe('Base Profile');
  });

  it('rejects an invalid plane at the schema layer', async () => {
    const { client, session } = await build();
    const result = await client.callTool({ name: 'create_sketch', arguments: { plane: 'ZZ' } });
    expect(result.isError).toBe(true);
    expect(session.getDocument().features).toHaveLength(0);
  });
});
