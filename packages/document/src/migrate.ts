import type { CadDocumentV1, CadDocumentV2 } from './types.js';

/** Migrates a V1 document to canonical V2 by adding an empty feature list; M1 entities are carried over unchanged. */
export function migrateToV2(document: CadDocumentV1): CadDocumentV2 {
  return {
    schemaVersion: 2,
    units: document.units,
    entities: document.entities,
    features: [],
  };
}
