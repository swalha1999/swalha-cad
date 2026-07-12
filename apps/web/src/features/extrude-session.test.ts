import type { CadDocumentV2, SketchEntity } from '@swalha-cad/document';
import { describe, expect, it } from 'vitest';
import {
  buildExtrudePreviewDocument,
  candidateExtrudeFeature,
  listSketchFeatures,
  PREVIEW_EXTRUDE_ID,
  validateExtrudeSession,
  type ExtrudeSession,
} from './extrude-session.js';

/** A closed counter-clockwise 40×20 rectangle profile on XY. */
function rectangleEntities(): SketchEntity[] {
  return [
    { id: 'p0', kind: 'point', x: 0, y: 0, construction: false },
    { id: 'p1', kind: 'point', x: 40, y: 0, construction: false },
    { id: 'p2', kind: 'point', x: 40, y: 20, construction: false },
    { id: 'p3', kind: 'point', x: 0, y: 20, construction: false },
    { id: 'l0', kind: 'line', startId: 'p0', endId: 'p1', construction: false },
    { id: 'l1', kind: 'line', startId: 'p1', endId: 'p2', construction: false },
    { id: 'l2', kind: 'line', startId: 'p2', endId: 'p3', construction: false },
    { id: 'l3', kind: 'line', startId: 'p3', endId: 'p0', construction: false },
  ];
}

function documentWith(entities: SketchEntity[], extra: CadDocumentV2['features'] = []): CadDocumentV2 {
  return {
    schemaVersion: 2,
    units: 'mm',
    entities: [],
    features: [{ id: 'sk1', kind: 'sketch', name: 'Sketch 1', plane: 'XY', entities, constraints: [], visible: true }, ...extra],
  };
}

function session(overrides: Partial<ExtrudeSession> = {}): ExtrudeSession {
  return { editingFeatureId: null, sketchId: 'sk1', depth: 10, direction: 'normal', reverse: false, ...overrides };
}

describe('listSketchFeatures', () => {
  it('returns only sketch features', () => {
    const doc = documentWith(rectangleEntities(), [
      { id: 'ex1', kind: 'extrude', name: 'Extrude 1', sketchId: 'sk1', depth: 5, direction: 'normal', visible: true },
    ]);
    expect(listSketchFeatures(doc).map((sketch) => sketch.id)).toEqual(['sk1']);
  });
});

describe('candidateExtrudeFeature', () => {
  it('returns null without a source sketch', () => {
    expect(candidateExtrudeFeature(documentWith(rectangleEntities()), session({ sketchId: null }))).toBeNull();
  });

  it('returns null for a non-positive or non-finite depth', () => {
    const doc = documentWith(rectangleEntities());
    expect(candidateExtrudeFeature(doc, session({ depth: 0 }))).toBeNull();
    expect(candidateExtrudeFeature(doc, session({ depth: -3 }))).toBeNull();
    expect(candidateExtrudeFeature(doc, session({ depth: Number.NaN }))).toBeNull();
  });

  it('builds a preview-id candidate for a new extrusion', () => {
    const candidate = candidateExtrudeFeature(documentWith(rectangleEntities()), session({ depth: 12, reverse: true }));
    expect(candidate).toMatchObject({
      id: PREVIEW_EXTRUDE_ID,
      kind: 'extrude',
      sketchId: 'sk1',
      depth: 12,
      direction: 'normal',
      reverse: true,
      visible: true,
    });
  });

  it('keeps the existing id and name when editing', () => {
    const doc = documentWith(rectangleEntities(), [
      { id: 'ex1', kind: 'extrude', name: 'My Boss', sketchId: 'sk1', depth: 5, direction: 'normal', visible: true },
    ]);
    const candidate = candidateExtrudeFeature(doc, session({ editingFeatureId: 'ex1', depth: 30 }));
    expect(candidate).toMatchObject({ id: 'ex1', name: 'My Boss', depth: 30 });
  });
});

describe('buildExtrudePreviewDocument', () => {
  it('returns the same document reference when no task is active', () => {
    const doc = documentWith(rectangleEntities());
    expect(buildExtrudePreviewDocument(doc, null)).toBe(doc);
  });

  it('returns the same document reference when the candidate is not buildable', () => {
    const doc = documentWith(rectangleEntities());
    expect(buildExtrudePreviewDocument(doc, session({ sketchId: null }))).toBe(doc);
  });

  it('appends a transient preview solid for a new extrusion', () => {
    const doc = documentWith(rectangleEntities());
    const preview = buildExtrudePreviewDocument(doc, session({ depth: 8 }));
    expect(preview).not.toBe(doc);
    expect(preview.features).toHaveLength(2);
    expect(preview.features[1]).toMatchObject({ id: PREVIEW_EXTRUDE_ID, kind: 'extrude', depth: 8 });
    // The committed document is untouched.
    expect(doc.features).toHaveLength(1);
  });

  it('replaces the feature in place when editing (no double geometry)', () => {
    const doc = documentWith(rectangleEntities(), [
      { id: 'ex1', kind: 'extrude', name: 'Extrude 1', sketchId: 'sk1', depth: 5, direction: 'normal', visible: true },
    ]);
    const preview = buildExtrudePreviewDocument(doc, session({ editingFeatureId: 'ex1', depth: 50 }));
    expect(preview.features).toHaveLength(2);
    const extrudes = preview.features.filter((feature) => feature.kind === 'extrude');
    expect(extrudes).toHaveLength(1);
    expect(extrudes[0]).toMatchObject({ id: 'ex1', depth: 50 });
  });
});

describe('validateExtrudeSession', () => {
  it('reports a missing source', () => {
    expect(validateExtrudeSession(documentWith(rectangleEntities()), session({ sketchId: null }))).toMatchObject({
      status: 'no-source',
    });
  });

  it('reports a non-positive depth as an error', () => {
    expect(validateExtrudeSession(documentWith(rectangleEntities()), session({ depth: 0 })).status).toBe('error');
  });

  it('reports an open/ambiguous profile as an error with a diagnostic', () => {
    const openChain: SketchEntity[] = [
      { id: 'p0', kind: 'point', x: 0, y: 0, construction: false },
      { id: 'p1', kind: 'point', x: 10, y: 0, construction: false },
      { id: 'l0', kind: 'line', startId: 'p0', endId: 'p1', construction: false },
    ];
    const result = validateExtrudeSession(documentWith(openChain), session());
    expect(result.status).toBe('error');
    expect(result.message).toBeTruthy();
  });

  it('reports a valid closed profile as ok', () => {
    expect(validateExtrudeSession(documentWith(rectangleEntities()), session()).status).toBe('ok');
  });
});
