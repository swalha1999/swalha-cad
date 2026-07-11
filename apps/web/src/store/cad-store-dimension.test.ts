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

function pointsOf(store: Store): Extract<SketchEntity, { kind: 'point' }>[] {
  return activeSketch(store).entities.filter((e): e is Extract<SketchEntity, { kind: 'point' }> => e.kind === 'point');
}

function lineId(store: Store): string {
  const line = activeSketch(store).entities.find((e) => e.kind === 'line');
  if (!line) throw new Error('expected a line');
  return line.id;
}

/** Enters an XY sketch and draws a single free (off-grid) line from (3,7) to (33,47): length 50. */
function drawLine(store: Store): void {
  store.getState().enterSketch('XY');
  store.getState().setSketchTool('line');
  store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(3, 7) });
  store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(33, 47) });
  store.getState().dispatchSketchEvent({ type: 'finish' });
  store.getState().setSketchTool(null);
}

function distance(store: Store): number {
  const [a, b] = pointsOf(store);
  return Math.hypot(b!.x - a!.x, b!.y - a!.y);
}

describe('dimension tool — activation', () => {
  it('starts awaiting a value from a selection-first single line', () => {
    const store = deterministicStore();
    drawLine(store);
    store.getState().setSketchSelection([lineId(store)]);

    store.getState().startDimension();

    const dimension = store.getState().sketch!.dimension;
    expect(dimension?.phase).toBe('awaiting');
    expect(dimension?.phase === 'awaiting' && dimension.measured).toBeCloseTo(50, 9);
    // Selection is consumed once the dimension resolves.
    expect(store.getState().sketchSelection).toEqual([]);
  });

  it('starts awaiting a value from two selection-first points', () => {
    const store = deterministicStore();
    drawLine(store);
    const [a, b] = pointsOf(store);
    store.getState().setSketchSelection([a!.id, b!.id]);

    store.getState().startDimension();

    const dimension = store.getState().sketch!.dimension;
    expect(dimension?.phase).toBe('awaiting');
  });

  it('starts a picking phase when no eligible geometry is selected', () => {
    const store = deterministicStore();
    drawLine(store);

    store.getState().startDimension();

    expect(store.getState().sketch!.dimension).toEqual({ phase: 'picking', points: [] });
  });

  it('toggles the dimension tool off when started again', () => {
    const store = deterministicStore();
    drawLine(store);
    store.getState().startDimension();
    store.getState().startDimension();
    expect(store.getState().sketch!.dimension).toBeNull();
  });

  it('resolves a command-first line click to an awaiting dimension', () => {
    const store = deterministicStore();
    drawLine(store);
    store.getState().startDimension();

    store.getState().dimensionPick(lineId(store));

    expect(store.getState().sketch!.dimension?.phase).toBe('awaiting');
  });

  it('resolves two command-first point clicks to an awaiting dimension', () => {
    const store = deterministicStore();
    drawLine(store);
    const [a, b] = pointsOf(store);
    store.getState().startDimension();

    store.getState().dimensionPick(a!.id);
    expect(store.getState().sketch!.dimension).toEqual({ phase: 'picking', points: [a!.id] });
    store.getState().dimensionPick(b!.id);

    expect(store.getState().sketch!.dimension?.phase).toBe('awaiting');
  });

  it('deactivates the dimension tool when a drawing tool is selected', () => {
    const store = deterministicStore();
    drawLine(store);
    store.getState().startDimension();
    store.getState().setSketchTool('line');
    expect(store.getState().sketch!.dimension).toBeNull();
  });
});

describe('dimension tool — commit', () => {
  it('applies the typed length through history, solving the geometry to it', () => {
    const store = deterministicStore();
    drawLine(store);
    store.getState().setSketchSelection([lineId(store)]);
    store.getState().startDimension();

    const outcome = store.getState().commitDimension(42.5);

    expect(outcome.applied).toBe(true);
    const constraints = activeSketch(store).constraints;
    expect(constraints).toHaveLength(1);
    expect(constraints[0]!.kind === 'distance' && constraints[0]!.value).toBe(42.5);
    expect(distance(store)).toBeCloseTo(42.5, 6);
    // The dimension tool returns to selection mode and selects the new constraint.
    expect(store.getState().sketch!.dimension).toBeNull();
    expect(store.getState().selectedConstraintId).toBe(constraints[0]!.id);
  });

  it('records exactly one undoable history entry that undo/redo reverses', () => {
    const store = deterministicStore();
    drawLine(store);
    store.getState().setSketchSelection([lineId(store)]);
    store.getState().startDimension();
    store.getState().commitDimension(42.5);

    expect(store.getState().canUndo).toBe(true);
    store.getState().undo();
    expect(activeSketch(store).constraints).toHaveLength(0);
    expect(distance(store)).toBeCloseTo(50, 6);

    expect(store.getState().canRedo).toBe(true);
    store.getState().redo();
    expect(activeSketch(store).constraints).toHaveLength(1);
    expect(distance(store)).toBeCloseTo(42.5, 6);
  });

  it('rejects a non-positive value without mutating and keeps awaiting a value', () => {
    const store = deterministicStore();
    drawLine(store);
    store.getState().setSketchSelection([lineId(store)]);
    store.getState().startDimension();
    const before = store.getState().document;

    const outcome = store.getState().commitDimension(-4);

    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe('invalid');
    expect(activeSketch(store).constraints).toHaveLength(0);
    expect(store.getState().sketch!.dimension?.phase).toBe('awaiting');
    // No command reached history: the document reference is untouched.
    expect(store.getState().document).toBe(before);
  });

  it('rejects a non-finite value without mutating', () => {
    const store = deterministicStore();
    drawLine(store);
    store.getState().setSketchSelection([lineId(store)]);
    store.getState().startDimension();

    const outcome = store.getState().commitDimension(Number.POSITIVE_INFINITY);

    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe('invalid');
    expect(activeSketch(store).constraints).toHaveLength(0);
  });

  it('rejects a conflicting value without corrupting the prior geometry', () => {
    const store = deterministicStore();
    drawLine(store);
    const [a, b] = pointsOf(store);
    // A first driving distance fixes the length at 10.
    store.getState().applyConstraint({ kind: 'distance', pointA: a!.id, pointB: b!.id, value: 10 });
    expect(distance(store)).toBeCloseTo(10, 6);

    store.getState().setSketchSelection([lineId(store)]);
    store.getState().startDimension();
    const outcome = store.getState().commitDimension(25);

    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe('conflict');
    // The contradictory dimension is not committed and the geometry is untouched.
    expect(activeSketch(store).constraints).toHaveLength(1);
    expect(distance(store)).toBeCloseTo(10, 6);
    expect(store.getState().sketch!.dimension?.phase).toBe('awaiting');
  });

  it('rejects an already-constrained (redundant) distance without mutating', () => {
    const store = deterministicStore();
    drawLine(store);
    const [a, b] = pointsOf(store);
    store.getState().applyConstraint({ kind: 'distance', pointA: a!.id, pointB: b!.id, value: 50 });

    store.getState().setSketchSelection([lineId(store)]);
    store.getState().startDimension();
    const outcome = store.getState().commitDimension(50);

    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe('redundant');
    expect(activeSketch(store).constraints).toHaveLength(1);
    expect(store.getState().sketch!.dimension?.phase).toBe('awaiting');
  });

  it('cancels an awaiting dimension without mutating the document', () => {
    const store = deterministicStore();
    drawLine(store);
    store.getState().setSketchSelection([lineId(store)]);
    store.getState().startDimension();
    const before = store.getState().document;

    store.getState().cancelDimension();

    expect(store.getState().sketch!.dimension).toBeNull();
    expect(activeSketch(store).constraints).toHaveLength(0);
    expect(store.getState().document).toBe(before);
  });
});
