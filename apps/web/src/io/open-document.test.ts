import { describe, expect, it } from 'vitest';
import type { CadDocumentV1 } from '@swalha-cad/document';
import { openCadDocumentFile } from './open-document.js';

const VALID_DOCUMENT: CadDocumentV1 = {
  schemaVersion: 1,
  units: 'mm',
  entities: [
    {
      id: 'box-1',
      name: 'Box',
      primitive: { kind: 'box', width: 40, height: 30, depth: 20 },
      transform: { translation: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
      visible: true,
    },
  ],
};

function jsonFile(contents: string, name = 'design.swcad.json'): File {
  return new File([contents], name, { type: 'application/json' });
}

describe('openCadDocumentFile', () => {
  it('accepts a valid V1 document', async () => {
    const result = await openCadDocumentFile(jsonFile(JSON.stringify(VALID_DOCUMENT)));

    expect(result).toEqual({ success: true, document: VALID_DOCUMENT });
  });

  it('rejects text that is not valid JSON', async () => {
    const result = await openCadDocumentFile(jsonFile('not json at all {'));

    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/json/i);
  });

  it('rejects JSON that does not satisfy the document schema', async () => {
    const result = await openCadDocumentFile(jsonFile(JSON.stringify({ schemaVersion: 1, units: 'mm' })));

    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error.length).toBeGreaterThan(0);
  });

  it('rejects an unknown schema version', async () => {
    const result = await openCadDocumentFile(
      jsonFile(JSON.stringify({ schemaVersion: 2, units: 'mm', entities: [] })),
    );

    expect(result.success).toBe(false);
  });

  it('rejects a document with an invalid entity, e.g. a non-positive dimension', async () => {
    const invalid: CadDocumentV1 = {
      ...VALID_DOCUMENT,
      entities: [
        {
          ...VALID_DOCUMENT.entities[0]!,
          primitive: { kind: 'box', width: 0, height: 30, depth: 20 },
        },
      ],
    };

    const result = await openCadDocumentFile(jsonFile(JSON.stringify(invalid)));

    expect(result.success).toBe(false);
  });
});
