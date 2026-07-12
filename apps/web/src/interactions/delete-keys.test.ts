import type { CadDocumentV2 } from '@swalha-cad/document';
import { describe, expect, it } from 'vitest';
import { createCadStore } from '../store/cad-store.js';
import { handleGlobalDelete, isDeleteKey, isTextEntryTarget } from './delete-keys.js';

function keyEvent(key: string, target: EventTarget | null, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key, ctrlKey: false, metaKey: false, altKey: false, target, ...mods } as unknown as KeyboardEvent;
}

function docWithBox(): CadDocumentV2 {
  return {
    schemaVersion: 2,
    units: 'mm',
    entities: [
      {
        id: 'box-1',
        name: 'Box',
        primitive: { kind: 'box', width: 10, height: 10, depth: 10 },
        transform: { translation: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
      },
    ],
    features: [],
  };
}

describe('isDeleteKey', () => {
  it('accepts plain Delete and Backspace', () => {
    expect(isDeleteKey(keyEvent('Delete', null))).toBe(true);
    expect(isDeleteKey(keyEvent('Backspace', null))).toBe(true);
  });

  it('rejects other keys', () => {
    expect(isDeleteKey(keyEvent('a', null))).toBe(false);
    expect(isDeleteKey(keyEvent('Enter', null))).toBe(false);
  });

  it('rejects delete keys held with a command/navigation modifier', () => {
    expect(isDeleteKey(keyEvent('Backspace', null, { metaKey: true }))).toBe(false);
    expect(isDeleteKey(keyEvent('Delete', null, { ctrlKey: true }))).toBe(false);
    expect(isDeleteKey(keyEvent('Backspace', null, { altKey: true }))).toBe(false);
  });
});

describe('isTextEntryTarget', () => {
  it('is true for input, textarea, select, and contenteditable', () => {
    expect(isTextEntryTarget(document.createElement('input'))).toBe(true);
    expect(isTextEntryTarget(document.createElement('textarea'))).toBe(true);
    expect(isTextEntryTarget(document.createElement('select'))).toBe(true);
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    expect(isTextEntryTarget(editable)).toBe(true);
  });

  it('is false for non-editable elements and null', () => {
    expect(isTextEntryTarget(document.createElement('div'))).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});

describe('handleGlobalDelete', () => {
  it('deletes the selected entity and reports handled', () => {
    const store = createCadStore(docWithBox());
    store.getState().selectEntity('box-1');

    const handled = handleGlobalDelete(store, keyEvent('Delete', document.body));

    expect(handled).toBe(true);
    expect(store.getState().document.entities).toHaveLength(0);
  });

  it('does not fire and reports not-handled when focus is in a numeric field', () => {
    const store = createCadStore(docWithBox());
    store.getState().selectEntity('box-1');
    const input = document.createElement('input');
    input.type = 'number';

    const handled = handleGlobalDelete(store, keyEvent('Backspace', input));

    expect(handled).toBe(false);
    expect(store.getState().document.entities).toHaveLength(1);
  });

  it('reports not-handled when nothing is selected, leaving Backspace navigation intact', () => {
    const store = createCadStore(docWithBox());

    const handled = handleGlobalDelete(store, keyEvent('Backspace', document.body));

    expect(handled).toBe(false);
  });

  it('routes to sketch deletion while a sketch is active', () => {
    const store = createCadStore({
      schemaVersion: 2,
      units: 'mm',
      entities: [],
      features: [
        {
          id: 'sk-1',
          kind: 'sketch',
          name: 'Sketch 1',
          plane: 'XY',
          visible: true,
          entities: [{ id: 'p1', kind: 'point', x: 0, y: 0, construction: false }],
          constraints: [],
        },
      ],
    });
    store.setState({
      sketch: { featureId: 'sk-1', plane: 'XY', tool: null, toolState: null, construction: false, polygonSides: 6, cursor: null, cursorSnap: null, dimension: null, modify: null },
    });
    store.getState().setSketchSelection(['p1']);

    const handled = handleGlobalDelete(store, keyEvent('Delete', document.body));

    expect(handled).toBe(true);
    const sketch = store.getState().document.features[0] as { entities: unknown[] };
    expect(sketch.entities).toHaveLength(0);
  });

  it('does not delete the part-studio selection while an empty sketch selection is active', () => {
    const store = createCadStore(docWithBox());
    store.setState({
      sketch: { featureId: 'sk-x', plane: 'XY', tool: null, toolState: null, construction: false, polygonSides: 6, cursor: null, cursorSnap: null, dimension: null, modify: null },
    });

    const handled = handleGlobalDelete(store, keyEvent('Delete', document.body));

    expect(handled).toBe(false);
  });
});
