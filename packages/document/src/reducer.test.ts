import { describe, expect, it } from 'vitest';
import { applyCommand, UnknownEntityError, UnknownFeatureError } from './reducer.js';
import { applyCommandToHistory, createHistory, undo } from './history.js';
import type { CadDocumentV2, CadEntity, ExtrudeFeature, SketchFeature } from './types.js';

function boxEntity(id: string): CadEntity {
  return {
    id,
    name: 'box',
    primitive: { kind: 'box', width: 10, height: 20, depth: 30 },
    transform: {
      translation: [0, 0, 0],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    },
    visible: true,
  };
}

function circleSketch(id: string): SketchFeature {
  return {
    id,
    kind: 'sketch',
    name: 'Sketch 1',
    plane: 'XY',
    entities: [
      { id: 'p1', kind: 'point', x: 0, y: 0, construction: false },
      { id: 'circ1', kind: 'circle', centerId: 'p1', radius: 5, construction: false },
    ],
    constraints: [{ id: 'c1', kind: 'radius', circleId: 'circ1', value: 5 }],
    visible: true,
  };
}

function extrudeFeature(id: string, sketchId: string): ExtrudeFeature {
  return {
    id,
    kind: 'extrude',
    name: 'Extrude 1',
    sketchId,
    depth: 20,
    direction: 'normal',
    visible: true,
  };
}

function emptyDocument(): CadDocumentV2 {
  return { schemaVersion: 2, units: 'mm', entities: [], features: [] };
}

describe('applyCommand — M1 entity commands', () => {
  it('creates a new entity', () => {
    const document = emptyDocument();
    const entity = boxEntity('entity-1');

    const next = applyCommand(document, { type: 'entity.create', entity });

    expect(next.entities).toEqual([entity]);
  });

  it('does not mutate the original document or its entities array on create', () => {
    const document = emptyDocument();
    const entity = boxEntity('entity-1');

    const next = applyCommand(document, { type: 'entity.create', entity });

    expect(document.entities).toEqual([]);
    expect(next.entities).not.toBe(document.entities);
    expect(next).not.toBe(document);
  });

  it('updates an existing entity with a partial patch', () => {
    const document: CadDocumentV2 = { ...emptyDocument(), entities: [boxEntity('entity-1')] };

    const next = applyCommand(document, {
      type: 'entity.update',
      id: 'entity-1',
      patch: { name: 'renamed', visible: false },
    });

    expect(next.entities).toEqual([{ ...boxEntity('entity-1'), name: 'renamed', visible: false }]);
  });

  it('does not mutate the original document or entity on update', () => {
    const original = boxEntity('entity-1');
    const document: CadDocumentV2 = { ...emptyDocument(), entities: [original] };

    const next = applyCommand(document, { type: 'entity.update', id: 'entity-1', patch: { name: 'renamed' } });

    expect(document.entities[0]).toBe(original);
    expect(original.name).toBe('box');
    expect(next.entities).not.toBe(document.entities);
  });

  it('throws UnknownEntityError when updating a missing entity', () => {
    const document = emptyDocument();

    expect(() => applyCommand(document, { type: 'entity.update', id: 'missing', patch: {} })).toThrow(
      UnknownEntityError,
    );
  });

  it('deletes an existing entity', () => {
    const document: CadDocumentV2 = {
      ...emptyDocument(),
      entities: [boxEntity('entity-1'), boxEntity('entity-2')],
    };

    const next = applyCommand(document, { type: 'entity.delete', id: 'entity-1' });

    expect(next.entities).toEqual([boxEntity('entity-2')]);
  });

  it('does not mutate the original document or its entities array on delete', () => {
    const document: CadDocumentV2 = { ...emptyDocument(), entities: [boxEntity('entity-1')] };

    const next = applyCommand(document, { type: 'entity.delete', id: 'entity-1' });

    expect(document.entities).toEqual([boxEntity('entity-1')]);
    expect(next.entities).not.toBe(document.entities);
  });

  it('throws UnknownEntityError when deleting a missing entity', () => {
    const document = emptyDocument();

    expect(() => applyCommand(document, { type: 'entity.delete', id: 'missing' })).toThrow(UnknownEntityError);
  });

  it('includes the entity id on UnknownEntityError', () => {
    const document = emptyDocument();
    expect.assertions(2);

    try {
      applyCommand(document, { type: 'entity.delete', id: 'missing-entity' });
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownEntityError);
      expect((error as UnknownEntityError).entityId).toBe('missing-entity');
    }
  });
});

describe('applyCommand — M2 feature commands', () => {
  it('creates a new sketch feature', () => {
    const document = emptyDocument();
    const feature = circleSketch('sketch-1');

    const next = applyCommand(document, { type: 'feature.create', feature });

    expect(next.features).toEqual([feature]);
  });

  it('creates a new extrude feature', () => {
    const document: CadDocumentV2 = { ...emptyDocument(), features: [circleSketch('sketch-1')] };
    const feature = extrudeFeature('extrude-1', 'sketch-1');

    const next = applyCommand(document, { type: 'feature.create', feature });

    expect(next.features).toEqual([circleSketch('sketch-1'), feature]);
  });

  it('does not mutate the original document or its features array on create', () => {
    const document = emptyDocument();
    const feature = circleSketch('sketch-1');

    const next = applyCommand(document, { type: 'feature.create', feature });

    expect(document.features).toEqual([]);
    expect(next.features).not.toBe(document.features);
    expect(next).not.toBe(document);
  });

  it('updates an existing feature with a partial patch', () => {
    const document: CadDocumentV2 = { ...emptyDocument(), features: [circleSketch('sketch-1')] };

    const next = applyCommand(document, {
      type: 'feature.update',
      id: 'sketch-1',
      patch: { name: 'Renamed', visible: false },
    });

    expect(next.features).toEqual([{ ...circleSketch('sketch-1'), name: 'Renamed', visible: false }]);
  });

  it('does not mutate the original document or feature on update', () => {
    const original = circleSketch('sketch-1');
    const document: CadDocumentV2 = { ...emptyDocument(), features: [original] };

    const next = applyCommand(document, { type: 'feature.update', id: 'sketch-1', patch: { name: 'Renamed' } });

    expect(document.features[0]).toBe(original);
    expect(original.name).toBe('Sketch 1');
    expect(next.features).not.toBe(document.features);
  });

  it('throws UnknownFeatureError when updating a missing feature', () => {
    const document = emptyDocument();

    expect(() => applyCommand(document, { type: 'feature.update', id: 'missing', patch: {} })).toThrow(
      UnknownFeatureError,
    );
  });

  it('deletes an existing feature', () => {
    const document: CadDocumentV2 = {
      ...emptyDocument(),
      features: [circleSketch('sketch-1'), circleSketch('sketch-2')],
    };

    const next = applyCommand(document, { type: 'feature.delete', id: 'sketch-1' });

    expect(next.features).toEqual([circleSketch('sketch-2')]);
  });

  it('does not mutate the original document or its features array on delete', () => {
    const document: CadDocumentV2 = { ...emptyDocument(), features: [circleSketch('sketch-1')] };

    const next = applyCommand(document, { type: 'feature.delete', id: 'sketch-1' });

    expect(document.features).toEqual([circleSketch('sketch-1')]);
    expect(next.features).not.toBe(document.features);
  });

  it('throws UnknownFeatureError when deleting a missing feature', () => {
    const document = emptyDocument();

    expect(() => applyCommand(document, { type: 'feature.delete', id: 'missing' })).toThrow(UnknownFeatureError);
  });

  it('includes the feature id on UnknownFeatureError', () => {
    const document = emptyDocument();
    expect.assertions(2);

    try {
      applyCommand(document, { type: 'feature.delete', id: 'missing-feature' });
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownFeatureError);
      expect((error as UnknownFeatureError).featureId).toBe('missing-feature');
    }
  });
});

describe('applyCommand — batch', () => {
  it('applies every sub-command in order against one document', () => {
    const document: CadDocumentV2 = {
      ...emptyDocument(),
      features: [circleSketch('sketch-1'), extrudeFeature('extrude-1', 'sketch-1')],
    };

    const next = applyCommand(document, {
      type: 'batch',
      commands: [
        { type: 'feature.delete', id: 'extrude-1' },
        { type: 'feature.delete', id: 'sketch-1' },
      ],
    });

    expect(next.features).toEqual([]);
  });

  it('is atomic: a throw on any sub-command leaves the original document untouched', () => {
    const document: CadDocumentV2 = { ...emptyDocument(), entities: [boxEntity('entity-1')] };

    expect(() =>
      applyCommand(document, {
        type: 'batch',
        commands: [
          { type: 'entity.delete', id: 'entity-1' },
          { type: 'entity.delete', id: 'missing' },
        ],
      }),
    ).toThrow(UnknownEntityError);
    expect(document.entities).toEqual([boxEntity('entity-1')]);
  });

  it('flattens a nested batch', () => {
    const document: CadDocumentV2 = {
      ...emptyDocument(),
      entities: [boxEntity('entity-1'), boxEntity('entity-2')],
    };

    const next = applyCommand(document, {
      type: 'batch',
      commands: [{ type: 'batch', commands: [{ type: 'entity.delete', id: 'entity-1' }] }, { type: 'entity.delete', id: 'entity-2' }],
    });

    expect(next.entities).toEqual([]);
  });

  it('records one undoable entry for a batch through history', () => {
    const document: CadDocumentV2 = {
      ...emptyDocument(),
      features: [circleSketch('sketch-1'), extrudeFeature('extrude-1', 'sketch-1')],
    };
    const history = applyCommandToHistory(createHistory(document), {
      type: 'batch',
      commands: [
        { type: 'feature.delete', id: 'extrude-1' },
        { type: 'feature.delete', id: 'sketch-1' },
      ],
    });

    expect(history.present.features).toEqual([]);
    expect(undo(history).present.features).toEqual([circleSketch('sketch-1'), extrudeFeature('extrude-1', 'sketch-1')]);
  });
});
