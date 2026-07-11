import type { CadDocumentV2, CadEntity, ExtrudeFeature, SketchFeature } from '@swalha-cad/document';
import { evaluateDocument } from '@swalha-cad/geometry';
import { describe, expect, it } from 'vitest';
import { createCadStore } from './cad-store.js';

function boxEntity(id: string, name = 'Box'): CadEntity {
  return {
    id,
    name,
    primitive: { kind: 'box', width: 10, height: 10, depth: 10 },
    transform: { translation: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
  };
}

/** A closed square sketch that can be extruded into a real body. */
function squareSketch(id: string, name: string): SketchFeature {
  return {
    id,
    kind: 'sketch',
    name,
    plane: 'XY',
    visible: true,
    entities: [
      { id: `${id}-p1`, kind: 'point', x: 0, y: 0, construction: false },
      { id: `${id}-p2`, kind: 'point', x: 10, y: 0, construction: false },
      { id: `${id}-p3`, kind: 'point', x: 10, y: 10, construction: false },
      { id: `${id}-p4`, kind: 'point', x: 0, y: 10, construction: false },
      { id: `${id}-l1`, kind: 'line', startId: `${id}-p1`, endId: `${id}-p2`, construction: false },
      { id: `${id}-l2`, kind: 'line', startId: `${id}-p2`, endId: `${id}-p3`, construction: false },
      { id: `${id}-l3`, kind: 'line', startId: `${id}-p3`, endId: `${id}-p4`, construction: false },
      { id: `${id}-l4`, kind: 'line', startId: `${id}-p4`, endId: `${id}-p1`, construction: false },
    ],
    constraints: [{ id: `${id}-h`, kind: 'horizontal', lineId: `${id}-l1` }],
  };
}

function extrude(id: string, name: string, sketchId: string): ExtrudeFeature {
  return { id, kind: 'extrude', name, sketchId, depth: 5, direction: 'normal', visible: true };
}

function docWithBodyAndExtrude(): CadDocumentV2 {
  return {
    schemaVersion: 2,
    units: 'mm',
    entities: [boxEntity('box-1', 'Box'), boxEntity('box-2', 'Box 2')],
    features: [squareSketch('sk-1', 'Sketch 1'), extrude('ex-1', 'Extrude 1', 'sk-1')],
  };
}

describe('selection model', () => {
  it('selects a feature and clears any entity selection', () => {
    const store = createCadStore(docWithBodyAndExtrude());
    store.getState().selectEntity('box-1');

    store.getState().selectFeature('ex-1');

    expect(store.getState().selectedFeatureId).toBe('ex-1');
    expect(store.getState().selectedEntityId).toBeNull();
  });

  it('ignores selecting an unknown feature', () => {
    const store = createCadStore(docWithBodyAndExtrude());
    store.getState().selectFeature('ghost');
    expect(store.getState().selectedFeatureId).toBeNull();
  });

  it('selectBody resolves an entity id to an entity selection', () => {
    const store = createCadStore(docWithBodyAndExtrude());
    store.getState().selectBody('box-1');
    expect(store.getState().selectedEntityId).toBe('box-1');
    expect(store.getState().selectedFeatureId).toBeNull();
  });

  it('selectBody resolves a derived body id to its owning feature', () => {
    const store = createCadStore(docWithBodyAndExtrude());
    store.getState().selectBody('ex-1');
    expect(store.getState().selectedFeatureId).toBe('ex-1');
    expect(store.getState().selectedEntityId).toBeNull();
  });

  it('selectBody(null) clears both selections', () => {
    const store = createCadStore(docWithBodyAndExtrude());
    store.getState().selectEntity('box-1');
    store.getState().selectBody(null);
    expect(store.getState().selectedEntityId).toBeNull();
    expect(store.getState().selectedFeatureId).toBeNull();
  });

  it('tracks a hovered id shared across surfaces', () => {
    const store = createCadStore(docWithBodyAndExtrude());
    store.getState().setHovered('box-2');
    expect(store.getState().hoveredId).toBe('box-2');
    store.getState().setHovered(null);
    expect(store.getState().hoveredId).toBeNull();
  });
});

describe('independent deletion', () => {
  it('deletes a selected entity immediately through history and clears the selection', () => {
    const store = createCadStore(docWithBodyAndExtrude());
    store.getState().selectEntity('box-1');

    store.getState().deleteSelected();

    const state = store.getState();
    expect(state.document.entities.some((entity) => entity.id === 'box-1')).toBe(false);
    expect(state.selectedEntityId).toBeNull();
    expect(state.pendingDeletion).toBeNull();
    expect(state.canUndo).toBe(true);
  });

  it('excludes a deleted body from the evaluated (rendered/exported) document', () => {
    const store = createCadStore(docWithBodyAndExtrude());
    const before = evaluateDocument(store.getState().document).bodies.map((body) => body.id);
    expect(before).toContain('box-1');

    store.getState().requestDelete({ kind: 'entity', id: 'box-1' });

    const after = evaluateDocument(store.getState().document).bodies.map((body) => body.id);
    expect(after).not.toContain('box-1');
  });

  it('restores a deleted entity on undo and re-deletes on redo', () => {
    const store = createCadStore(docWithBodyAndExtrude());
    store.getState().requestDelete({ kind: 'entity', id: 'box-1' });

    store.getState().undo();
    expect(store.getState().document.entities.some((entity) => entity.id === 'box-1')).toBe(true);

    store.getState().redo();
    expect(store.getState().document.entities.some((entity) => entity.id === 'box-1')).toBe(false);
  });

  it('deletes an extrude (no dependents) immediately', () => {
    const store = createCadStore(docWithBodyAndExtrude());
    store.getState().selectFeature('ex-1');

    store.getState().deleteSelected();

    expect(store.getState().document.features.some((feature) => feature.id === 'ex-1')).toBe(false);
    expect(store.getState().document.features.some((feature) => feature.id === 'sk-1')).toBe(true);
    expect(store.getState().pendingDeletion).toBeNull();
  });

  it('does nothing when deleteSelected is called with no selection', () => {
    const store = createCadStore(docWithBodyAndExtrude());
    store.getState().deleteSelected();
    expect(store.getState().canUndo).toBe(false);
  });
});

describe('dependency-aware deletion', () => {
  it('opens an impact confirmation instead of silently cascading a sketch with a dependent', () => {
    const store = createCadStore(docWithBodyAndExtrude());
    store.getState().selectFeature('sk-1');

    store.getState().deleteSelected();

    const plan = store.getState().pendingDeletion;
    expect(plan).not.toBeNull();
    expect(plan!.targetName).toBe('Sketch 1');
    expect(plan!.dependents).toEqual([{ id: 'ex-1', name: 'Extrude 1' }]);
    // Nothing removed yet — the document is untouched until confirmation.
    expect(store.getState().document.features).toHaveLength(2);
    expect(store.getState().canUndo).toBe(false);
  });

  it('confirming performs one atomic dependency-aware transaction restored by a single undo', () => {
    const store = createCadStore(docWithBodyAndExtrude());
    store.getState().requestDelete({ kind: 'feature', id: 'sk-1' });

    store.getState().confirmDeletion();

    let state = store.getState();
    expect(state.document.features).toHaveLength(0);
    expect(state.pendingDeletion).toBeNull();

    store.getState().undo();
    state = store.getState();
    expect(state.document.features.map((feature) => feature.id).sort()).toEqual(['ex-1', 'sk-1']);
    // A single undo brings both back — proof it was one transaction.
    expect(state.canUndo).toBe(false);
  });

  it('cancelling leaves the document unchanged and closes the dialog', () => {
    const store = createCadStore(docWithBodyAndExtrude());
    store.getState().requestDelete({ kind: 'feature', id: 'sk-1' });

    store.getState().cancelDeletion();

    expect(store.getState().pendingDeletion).toBeNull();
    expect(store.getState().document.features).toHaveLength(2);
    expect(store.getState().canUndo).toBe(false);
  });
});

describe('sketch-mode deletion', () => {
  function enterExistingSketch() {
    const store = createCadStore({
      schemaVersion: 2,
      units: 'mm',
      entities: [],
      features: [squareSketch('sk-1', 'Sketch 1')],
    });
    // Enter sketch mode on the existing feature by creating a fresh session pointing at it.
    // enterSketch creates a new feature, so instead drive the session directly through the public API:
    store.setState({
      sketch: { featureId: 'sk-1', plane: 'XY', tool: null, toolState: null, construction: false, cursor: null, cursorSnap: null, dimension: null },
    });
    return store;
  }

  it('deletes selected sketch entities in one undoable feature update, cascading and cleaning constraints', () => {
    const store = enterExistingSketch();
    store.getState().setSketchSelection(['sk-1-p1']);

    store.getState().deleteSketchSelection();

    const sketch = store.getState().document.features[0] as SketchFeature;
    // p1 and the two lines using it are gone; its horizontal constraint too.
    expect(sketch.entities.some((entity) => entity.id === 'sk-1-p1')).toBe(false);
    expect(sketch.entities.some((entity) => entity.id === 'sk-1-l1')).toBe(false);
    expect(sketch.entities.some((entity) => entity.id === 'sk-1-l4')).toBe(false);
    expect(sketch.constraints).toHaveLength(0);
    expect(store.getState().sketchSelection).toEqual([]);
    expect(store.getState().canUndo).toBe(true);

    store.getState().undo();
    expect((store.getState().document.features[0] as SketchFeature).entities).toHaveLength(8);
  });

  it('deletes the selected constraint when no entities are selected', () => {
    const store = enterExistingSketch();
    store.getState().selectConstraint('sk-1-h');

    store.getState().deleteSketchSelection();

    expect((store.getState().document.features[0] as SketchFeature).constraints).toHaveLength(0);
  });

  it('is a no-op when nothing is selected in the sketch', () => {
    const store = enterExistingSketch();
    store.getState().deleteSketchSelection();
    expect(store.getState().canUndo).toBe(false);
  });
});
