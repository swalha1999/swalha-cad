import { describe, expect, it } from 'vitest';
import { parseCadDocument } from './schema.js';
import type { CadDocumentV2, SketchFeature } from './types.js';

function sketchFeature(face?: { bodyId: string; faceId: string }): SketchFeature {
  return {
    id: 'sk',
    kind: 'sketch',
    name: 'Sketch 1',
    plane: 'XY',
    ...(face ? { face } : {}),
    entities: [],
    constraints: [],
    visible: true,
  };
}

function documentWith(feature: SketchFeature): CadDocumentV2 {
  return { schemaVersion: 2, units: 'mm', entities: [], features: [feature] };
}

describe('planar-face sketch support (persistence)', () => {
  it('parses a sketch carrying a planar-face support', () => {
    const result = parseCadDocument(documentWith(sketchFeature({ bodyId: 'box', faceId: '+z' })));
    expect(result.success).toBe(true);
    if (!result.success) return;
    const sketch = result.data.features[0] as SketchFeature;
    expect(sketch.face).toEqual({ bodyId: 'box', faceId: '+z' });
  });

  it('round-trips a face-supported sketch through JSON without loss', () => {
    const original = documentWith(sketchFeature({ bodyId: 'ex', faceId: 'side:l2' }));
    const reparsed = parseCadDocument(JSON.parse(JSON.stringify(original)));
    expect(reparsed.success).toBe(true);
    if (!reparsed.success) return;
    expect(reparsed.data).toEqual(original);
  });

  it('still loads a legacy origin-plane sketch with no face field', () => {
    const result = parseCadDocument(documentWith(sketchFeature()));
    expect(result.success).toBe(true);
    if (!result.success) return;
    const sketch = result.data.features[0] as SketchFeature;
    expect('face' in sketch).toBe(false);
  });

  it('preserves the empty face list when migrating a V1 document', () => {
    const v1 = { schemaVersion: 1, units: 'mm', entities: [] };
    const result = parseCadDocument(v1);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ schemaVersion: 2, units: 'mm', entities: [], features: [] });
  });

  it('rejects a face support missing its bodyId', () => {
    const result = parseCadDocument(documentWith(sketchFeature({ faceId: '+z' } as never)));
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys inside a face support (strict)', () => {
    const bad = documentWith(sketchFeature({ bodyId: 'b', faceId: 'f', extra: 1 } as never));
    expect(parseCadDocument(bad).success).toBe(false);
  });
});
