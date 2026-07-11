import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CadDocumentV1 } from '@swalha-cad/document';
import { DocumentSession, DocumentSessionError } from './document-session.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swalha-cad-mcp-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const BOX_ENTITY = {
  id: 'box-1',
  name: 'Box',
  primitive: { kind: 'box', width: 10, height: 10, depth: 10 },
  transform: { translation: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
  visible: true,
} as const;

const SEED_DOCUMENT_V1: CadDocumentV1 = {
  schemaVersion: 1,
  units: 'mm',
  entities: [BOX_ENTITY],
};

describe('DocumentSession.open', () => {
  it('creates and persists an empty V2 document when the startup path does not exist', async () => {
    const filePath = join(dir, 'design.swcad.json');

    const session = await DocumentSession.open(filePath);

    expect(session.getDocument()).toEqual({ schemaVersion: 2, units: 'mm', entities: [], features: [] });
    const onDisk = JSON.parse(await readFile(filePath, 'utf8'));
    expect(onDisk).toEqual({ schemaVersion: 2, units: 'mm', entities: [], features: [] });
  });

  it('loads and migrates an existing V1 document to canonical V2', async () => {
    const filePath = join(dir, 'design.swcad.json');
    await writeFile(filePath, JSON.stringify(SEED_DOCUMENT_V1), 'utf8');

    const session = await DocumentSession.open(filePath);

    expect(session.getDocument()).toEqual({ ...SEED_DOCUMENT_V1, schemaVersion: 2, features: [] });
  });

  it('rejects malformed JSON with a DocumentSessionError', async () => {
    const filePath = join(dir, 'design.swcad.json');
    await writeFile(filePath, '{ not json', 'utf8');

    await expect(DocumentSession.open(filePath)).rejects.toBeInstanceOf(DocumentSessionError);
  });

  it('rejects a document that fails schema validation', async () => {
    const filePath = join(dir, 'design.swcad.json');
    await writeFile(filePath, JSON.stringify({ schemaVersion: 2, units: 'mm', entities: [] }), 'utf8');

    await expect(DocumentSession.open(filePath)).rejects.toMatchObject({ code: 'document_invalid_schema' });
  });
});

describe('DocumentSession.applyCommand', () => {
  it('applies a create command through the shared reducer and persists atomically', async () => {
    const filePath = join(dir, 'design.swcad.json');
    const session = await DocumentSession.open(filePath);

    const next = await session.applyCommand({ type: 'entity.create', entity: BOX_ENTITY });

    expect(next.entities).toEqual([BOX_ENTITY]);
    expect(session.getDocument().entities).toEqual([BOX_ENTITY]);
    const onDisk = JSON.parse(await readFile(filePath, 'utf8'));
    expect(onDisk.entities).toEqual([BOX_ENTITY]);
  });

  it('leaves the in-memory and on-disk document unchanged when a command references an unknown entity', async () => {
    const filePath = join(dir, 'design.swcad.json');
    const session = await DocumentSession.open(filePath);

    await expect(
      session.applyCommand({ type: 'entity.update', id: 'missing', patch: { name: 'Renamed' } }),
    ).rejects.toMatchObject({ code: 'entity_not_found' });

    expect(session.getDocument().entities).toEqual([]);
    const onDisk = JSON.parse(await readFile(filePath, 'utf8'));
    expect(onDisk.entities).toEqual([]);
  });

  it('never leaves a partial temp file behind after persisting', async () => {
    const filePath = join(dir, 'design.swcad.json');
    const session = await DocumentSession.open(filePath);

    await session.applyCommand({ type: 'entity.create', entity: BOX_ENTITY });

    const files = await readdir(dir);
    expect(files).toEqual(['design.swcad.json']);
  });
});

describe('DocumentSession id generation', () => {
  it('uses injected id generator for stable, testable ids', async () => {
    const filePath = join(dir, 'design.swcad.json');
    let counter = 0;
    const session = await DocumentSession.open(filePath, { createId: () => `id-${++counter}` });

    expect(session.nextId()).toBe('id-1');
    expect(session.nextId()).toBe('id-2');
  });
});
