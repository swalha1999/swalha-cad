import { describe, expect, it } from 'vitest';
import { parseCadDocument } from './schema.js';
import type { CadEntity, Primitive } from './types.js';

function entityWith(primitive: Primitive): CadEntity {
  return {
    id: `entity-${primitive.kind}`,
    name: primitive.kind,
    primitive,
    transform: {
      translation: [0, 0, 0],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    },
    visible: true,
  };
}

describe('parseCadDocument', () => {
  it('accepts a valid empty V1 document', () => {
    const doc = {
      schemaVersion: 1,
      units: 'mm',
      entities: [],
    };

    const result = parseCadDocument(doc);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(doc);
    }
  });

  it('accepts each primitive type', () => {
    const doc = {
      schemaVersion: 1,
      units: 'mm',
      entities: [
        entityWith({ kind: 'box', width: 10, height: 20, depth: 30 }),
        entityWith({ kind: 'cylinder', radius: 5, height: 15, segments: 16 }),
        entityWith({ kind: 'lBracket', width: 40, height: 40, depth: 10, thickness: 5 }),
      ],
    };

    const result = parseCadDocument(doc);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(doc);
    }
  });

  it.each([
    { kind: 'box', width: 0, height: 20, depth: 30 },
    { kind: 'box', width: -10, height: 20, depth: 30 },
    { kind: 'cylinder', radius: 0, height: 15, segments: 16 },
    { kind: 'cylinder', radius: 5, height: -15, segments: 16 },
    { kind: 'lBracket', width: 40, height: 40, depth: 0, thickness: 5 },
    { kind: 'lBracket', width: 40, height: 40, depth: 10, thickness: -5 },
  ] as const)('rejects non-positive dimensions for %o', (primitive) => {
    const doc = {
      schemaVersion: 1,
      units: 'mm',
      entities: [entityWith(primitive)],
    };

    const result = parseCadDocument(doc);

    expect(result.success).toBe(false);
  });

  it.each([2, 2.5])('rejects a cylinder with invalid segment count %s', (segments) => {
    const doc = {
      schemaVersion: 1,
      units: 'mm',
      entities: [entityWith({ kind: 'cylinder', radius: 5, height: 15, segments })],
    };

    const result = parseCadDocument(doc);

    expect(result.success).toBe(false);
  });

  it.each([
    { width: 40, height: 40, depth: 10, thickness: 40 },
    { width: 40, height: 40, depth: 10, thickness: 45 },
    { width: 20, height: 40, depth: 10, thickness: 20 },
    { width: 40, height: 20, depth: 10, thickness: 20 },
  ] as const)('rejects an l-bracket whose thickness is not strictly less than width/height %o', (primitive) => {
    const doc = {
      schemaVersion: 1,
      units: 'mm',
      entities: [entityWith({ kind: 'lBracket', ...primitive })],
    };

    const result = parseCadDocument(doc);

    expect(result.success).toBe(false);
  });

  it('accepts an l-bracket whose thickness is strictly less than width and height', () => {
    const doc = {
      schemaVersion: 1,
      units: 'mm',
      entities: [entityWith({ kind: 'lBracket', width: 40, height: 40, depth: 10, thickness: 5 })],
    };

    const result = parseCadDocument(doc);

    expect(result.success).toBe(true);
  });

  it('rejects unknown schema versions', () => {
    const doc = {
      schemaVersion: 2,
      units: 'mm',
      entities: [],
    };

    const result = parseCadDocument(doc);

    expect(result.success).toBe(false);
  });

  it('round-trips a document through JSON without data loss', () => {
    const doc = {
      schemaVersion: 1,
      units: 'mm',
      entities: [
        entityWith({ kind: 'box', width: 10, height: 20, depth: 30 }),
        entityWith({ kind: 'cylinder', radius: 5, height: 15, segments: 16 }),
        entityWith({ kind: 'lBracket', width: 40, height: 40, depth: 10, thickness: 5 }),
      ],
    };

    const result = parseCadDocument(doc);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const roundTripped = JSON.parse(JSON.stringify(result.data));
    expect(roundTripped).toEqual(doc);

    const reparsed = parseCadDocument(roundTripped);
    expect(reparsed.success).toBe(true);
    if (reparsed.success) {
      expect(reparsed.data).toEqual(doc);
    }
  });
});
