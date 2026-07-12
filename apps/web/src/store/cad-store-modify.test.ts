import type { SketchEntity, SketchFeature } from '@swalha-cad/document';
import { describe, expect, it } from 'vitest';
import type { SnapResult } from '../sketch/tools/types.js';
import { createCadStore, selectActiveSketch } from './cad-store.js';

function deterministicStore() {
  let n = 0;
  return createCadStore(undefined, { createId: () => `id-${++n}` });
}

function freeSnap(x: number, y: number): SnapResult {
  return { point: { x, y }, ref: { kind: 'new', x, y }, kind: 'free' };
}

type Store = ReturnType<typeof deterministicStore>;

function activeSketch(store: Store): SketchFeature {
  const sketch = selectActiveSketch(store.getState());
  if (!sketch) throw new Error('expected an active sketch');
  return sketch;
}

/** Draws one straight line from a→b through the line tool + history. */
function drawLine(store: Store, a: [number, number], b: [number, number]): void {
  store.getState().setSketchTool('line');
  store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(a[0], a[1]) });
  store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(b[0], b[1]) });
  store.getState().dispatchSketchEvent({ type: 'finish' });
}

function lines(sketch: SketchFeature): Extract<SketchEntity, { kind: 'line' }>[] {
  return sketch.entities.filter((e): e is Extract<SketchEntity, { kind: 'line' }> => e.kind === 'line');
}
function points(sketch: SketchFeature): Extract<SketchEntity, { kind: 'point' }>[] {
  return sketch.entities.filter((e): e is Extract<SketchEntity, { kind: 'point' }> => e.kind === 'point');
}

describe('setSketchModifyTool', () => {
  it('activates a modify tool, clearing any drawing tool and selection', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('line');
    store.getState().setSketchModifyTool('trim');

    const session = store.getState().sketch!;
    expect(session.modify).toEqual({ tool: 'trim', point: null });
    expect(session.tool).toBeNull();
    expect(session.toolState).toBeNull();
    expect(store.getState().sketchSelection).toEqual([]);
  });

  it('toggles off when the active tool is re-selected', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchModifyTool('split');
    store.getState().setSketchModifyTool('split');
    expect(store.getState().sketch?.modify).toBeNull();
  });

  it('selecting a drawing tool leaves modify mode', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchModifyTool('trim');
    store.getState().setSketchTool('rectangle');
    expect(store.getState().sketch?.modify).toBeNull();
    expect(store.getState().sketch?.tool).toBe('rectangle');
  });
});

describe('applySketchModify: trim', () => {
  function seedCrossedLine(store: Store): void {
    store.getState().enterSketch('XY');
    drawLine(store, [0, 0], [120, 0]); // target
    drawLine(store, [100, -10], [100, 10]); // crossing boundary
    store.getState().setSketchModifyTool('trim');
  }

  it('trims the overhang piece through a single undoable history command', () => {
    const store = deterministicStore();
    seedCrossedLine(store);
    const pastBefore = store.getState().history.past.length;

    store.getState().applySketchModify({ x: 110, y: 0 });

    const sketch = activeSketch(store);
    expect(lines(sketch)).toHaveLength(2); // the crossing line + the surviving target piece
    expect(points(sketch).some((p) => p.x === 120 && p.y === 0)).toBe(false); // orphan endpoint removed
    expect(points(sketch).some((p) => Math.abs(p.x - 100) < 1e-9 && Math.abs(p.y) < 1e-9)).toBe(true); // fused boundary
    expect(store.getState().history.past.length).toBe(pastBefore + 1); // exactly one command
    expect(store.getState().sketch?.modify?.tool).toBe('trim'); // tool stays active
  });

  it('undo/redo restores exact entities and re-applies deterministically', () => {
    const store = deterministicStore();
    seedCrossedLine(store);
    const before = activeSketch(store);

    store.getState().applySketchModify({ x: 110, y: 0 });
    const trimmed = activeSketch(store);

    store.getState().undo();
    expect(activeSketch(store).entities).toEqual(before.entities);

    store.getState().redo();
    expect(activeSketch(store).entities).toEqual(trimmed.entities);
  });

  it('is a no-op (no history entry) when the click resolves to no intersection', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    drawLine(store, [0, 0], [100, 0]); // lone line, nothing to trim against
    store.getState().setSketchModifyTool('trim');
    const documentBefore = store.getState().document;
    const pastBefore = store.getState().history.past.length;

    store.getState().applySketchModify({ x: 50, y: 0 });

    expect(store.getState().document).toBe(documentBefore); // unchanged reference
    expect(store.getState().history.past.length).toBe(pastBefore);
  });
});

describe('applySketchModify: split', () => {
  it('splits a line into two at a continuous interior coordinate', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    drawLine(store, [0, 0], [100, 0]);
    store.getState().setSketchModifyTool('split');

    store.getState().applySketchModify({ x: 37.3, y: 0.2 });

    const sketch = activeSketch(store);
    expect(lines(sketch)).toHaveLength(2);
    const shared = lines(sketch)[0]!.endId;
    expect(lines(sketch)[1]!.startId).toBe(shared);
    const sharedPoint = points(sketch).find((p) => p.id === shared)!;
    expect(sharedPoint.x).toBeCloseTo(37.3, 6); // off-grid coordinate preserved
  });
});
