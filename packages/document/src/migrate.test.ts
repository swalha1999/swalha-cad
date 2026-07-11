import { describe, expect, it } from 'vitest';
import { migrateToV2 } from './migrate.js';
import type { CadDocumentV1, CadEntity } from './types.js';

function boxEntity(id: string): CadEntity {
  return {
    id,
    name: 'box',
    primitive: { kind: 'box', width: 10, height: 20, depth: 30 },
    transform: { translation: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
  };
}

describe('migrateToV2', () => {
  it('adds schemaVersion 2 and an empty features array to an empty V1 document', () => {
    const v1: CadDocumentV1 = { schemaVersion: 1, units: 'mm', entities: [] };

    expect(migrateToV2(v1)).toEqual({ schemaVersion: 2, units: 'mm', entities: [], features: [] });
  });

  it('preserves M1 entities unchanged', () => {
    const entities = [boxEntity('entity-1'), boxEntity('entity-2')];
    const v1: CadDocumentV1 = { schemaVersion: 1, units: 'mm', entities };

    const v2 = migrateToV2(v1);

    expect(v2.entities).toEqual(entities);
    expect(v2.features).toEqual([]);
    expect(v2.schemaVersion).toBe(2);
  });

  it('does not mutate the source document', () => {
    const entities = [boxEntity('entity-1')];
    const v1: CadDocumentV1 = { schemaVersion: 1, units: 'mm', entities };

    migrateToV2(v1);

    expect(v1.schemaVersion).toBe(1);
    expect(v1).not.toHaveProperty('features');
  });
});
