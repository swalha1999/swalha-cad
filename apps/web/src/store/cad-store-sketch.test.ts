import type { SketchFeature } from '@swalha-cad/document';
import { describe, expect, it } from 'vitest';
import type { SnapResult } from '../sketch/tools/types.js';
import { createCadStore, selectActiveSketch } from './cad-store.js';

/** A store whose ids are deterministic so tests can assert on feature/entity ids. */
function deterministicStore() {
  let n = 0;
  return createCadStore(undefined, { createId: () => `id-${++n}` });
}

function freeSnap(x: number, y: number): SnapResult {
  return { point: { x, y }, ref: { kind: 'new', x, y }, kind: 'grid' };
}

function activeSketch(store: ReturnType<typeof deterministicStore>): SketchFeature {
  const sketch = selectActiveSketch(store.getState());
  if (!sketch) throw new Error('expected an active sketch');
  return sketch;
}

describe('enterSketch', () => {
  it('creates an empty sketch feature on the chosen plane and enters sketch mode', () => {
    const store = deterministicStore();

    const id = store.getState().enterSketch('XZ');

    const state = store.getState();
    expect(state.sketch).toMatchObject({ featureId: id, plane: 'XZ', tool: null });
    const feature = state.document.features.find((candidate) => candidate.id === id);
    expect(feature).toMatchObject({ kind: 'sketch', plane: 'XZ', entities: [], name: 'Sketch 1' });
  });

  it('aligns the camera orthographically for a true 2D workspace', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    expect(store.getState().cameraProjection).toBe('orthographic');
  });

  it('routes feature creation through undoable history', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');

    expect(store.getState().canUndo).toBe(true);
    store.getState().undo();
    expect(store.getState().document.features).toHaveLength(0);
  });

  it('disambiguates sketch names', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().finishSketch();
    store.getState().enterSketch('XY');
    const names = store.getState().document.features.map((feature) => feature.name);
    expect(names).toEqual(['Sketch 1', 'Sketch 2']);
  });
});

describe('sketch tool selection', () => {
  it('activates a tool with a fresh pending state', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');

    store.getState().setSketchTool('rectangle');

    expect(store.getState().sketch?.tool).toBe('rectangle');
    expect(store.getState().sketch?.toolState).toEqual({ tool: 'rectangle', start: null, cursor: null });
  });

  it('ignores tool selection outside sketch mode', () => {
    const store = deterministicStore();
    store.getState().setSketchTool('line');
    expect(store.getState().sketch).toBeNull();
  });
});

describe('dispatchSketchEvent', () => {
  it('commits a rectangle through history when two corners are clicked', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('rectangle');

    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 0) });
    expect(activeSketch(store).entities).toHaveLength(0); // first corner: nothing committed yet
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(40, 30) });

    const entities = activeSketch(store).entities;
    expect(entities.filter((entity) => entity.kind === 'point')).toHaveLength(4);
    expect(entities.filter((entity) => entity.kind === 'line')).toHaveLength(4);
    expect(store.getState().canUndo).toBe(true);
  });

  it('commits a circle from a center and rim click', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('circle');

    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 0) });
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 20) });

    const circles = activeSketch(store).entities.filter((entity) => entity.kind === 'circle');
    expect(circles).toEqual([{ id: expect.any(String), kind: 'circle', centerId: expect.any(String), radius: 20, construction: false }]);
  });

  it('commits a connected line chain only on finish, as one undoable operation', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('line');

    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 0) });
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(10, 0) });
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(10, 10) });
    expect(activeSketch(store).entities).toHaveLength(0); // nothing committed mid-chain

    store.getState().dispatchSketchEvent({ type: 'finish' });

    const entities = activeSketch(store).entities;
    expect(entities.filter((entity) => entity.kind === 'line')).toHaveLength(2);
    const undoCountBefore = store.getState().canUndo;
    expect(undoCountBefore).toBe(true);
    store.getState().undo();
    // A single undo removes the whole chain (one command), leaving the empty sketch.
    expect(activeSketch(store).entities).toHaveLength(0);
  });

  it('records construction geometry distinctly when the mode is on', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchConstruction(true);
    store.getState().setSketchTool('circle');

    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 0) });
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(5, 0) });

    expect(activeSketch(store).entities.every((entity) => entity.construction)).toBe(true);
  });

  it('cancels the active step on Escape, keeping the tool but committing nothing', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('rectangle');
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 0) });

    store.getState().dispatchSketchEvent({ type: 'cancel' });

    expect(store.getState().sketch?.tool).toBe('rectangle');
    expect(store.getState().sketch?.toolState).toMatchObject({ start: null });
    expect(activeSketch(store).entities).toHaveLength(0);
  });

  it('deactivates the tool on Escape when no step is pending', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('rectangle');

    store.getState().dispatchSketchEvent({ type: 'cancel' });

    expect(store.getState().sketch?.tool).toBeNull();
    expect(store.getState().sketch).not.toBeNull(); // still in sketch mode
  });

  it('updates the cursor and snap kind on move for the snap indicator', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');

    store.getState().dispatchSketchEvent({ type: 'move', snap: { point: { x: 5, y: 6 }, ref: { kind: 'new', x: 5, y: 6 }, kind: 'grid' } });

    expect(store.getState().sketch?.cursor).toEqual({ x: 5, y: 6 });
    expect(store.getState().sketch?.cursorSnap).toBe('grid');
  });
});

describe('finishSketch', () => {
  it('leaves sketch mode but preserves the created feature', () => {
    const store = deterministicStore();
    const id = store.getState().enterSketch('XY');
    store.getState().setSketchTool('circle');
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 0) });
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(10, 0) });

    store.getState().finishSketch();

    expect(store.getState().sketch).toBeNull();
    expect(store.getState().cameraProjection).toBe('perspective');
    expect(store.getState().document.features.find((feature) => feature.id === id)).toBeDefined();
  });
});
