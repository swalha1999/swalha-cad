import type { SketchEntity, SketchFeature } from '@swalha-cad/document';
import { describe, expect, it } from 'vitest';
import type { NewConstraint } from '../sketch/constraint-actions.js';
import type { SnapResult } from '../sketch/tools/types.js';
import { createCadStore, selectActiveSketch } from './cad-store.js';

function deterministicStore() {
  let n = 0;
  return createCadStore(undefined, { createId: () => `id-${++n}` });
}

function freeSnap(x: number, y: number): SnapResult {
  return { point: { x, y }, ref: { kind: 'new', x, y }, kind: 'grid' };
}

type Store = ReturnType<typeof deterministicStore>;

function activeSketch(store: Store): SketchFeature {
  const sketch = selectActiveSketch(store.getState());
  if (!sketch) throw new Error('expected an active sketch');
  return sketch;
}

function entitiesOfKind<K extends SketchEntity['kind']>(store: Store, kind: K): Extract<SketchEntity, { kind: K }>[] {
  return activeSketch(store).entities.filter((e): e is Extract<SketchEntity, { kind: K }> => e.kind === kind);
}

/** Enters an XY sketch and draws an axis-aligned 40×30 rectangle from two corners. */
function drawRectangle(store: Store): { points: string[]; lines: string[] } {
  store.getState().enterSketch('XY');
  store.getState().setSketchTool('rectangle');
  store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 0) });
  store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(40, 30) });
  store.getState().setSketchTool(null);
  return {
    points: entitiesOfKind(store, 'point').map((p) => p.id),
    lines: entitiesOfKind(store, 'line').map((l) => l.id),
  };
}

/** Applies the six constraints that fully constrain an axis-aligned rectangle. */
function constrainRectangle(store: Store, lines: string[]): void {
  const lineEntity = (id: string): Extract<SketchEntity, { kind: 'line' }> => {
    const entity = activeSketch(store).entities.find((e) => e.id === id);
    if (entity?.kind !== 'line') throw new Error(`expected a line for ${id}`);
    return entity;
  };
  const l0 = lineEntity(lines[0]!);
  const l1 = lineEntity(lines[1]!);
  const constraints: NewConstraint[] = [
    { kind: 'horizontal', lineId: lines[0]! },
    { kind: 'vertical', lineId: lines[1]! },
    { kind: 'horizontal', lineId: lines[2]! },
    { kind: 'vertical', lineId: lines[3]! },
    { kind: 'distance', pointA: l0.startId, pointB: l0.endId, value: 40 },
    { kind: 'distance', pointA: l1.startId, pointB: l1.endId, value: 30 },
  ];
  for (const c of constraints) store.getState().applyConstraint(c);
}

describe('sketch entity selection', () => {
  it('toggles selection of an entity that exists in the active sketch', () => {
    const store = deterministicStore();
    const { points } = drawRectangle(store);

    store.getState().toggleSketchEntitySelection(points[0]!);
    expect(store.getState().sketchSelection).toEqual([points[0]]);

    store.getState().toggleSketchEntitySelection(points[1]!);
    expect(store.getState().sketchSelection).toEqual([points[0], points[1]]);

    store.getState().toggleSketchEntitySelection(points[0]!);
    expect(store.getState().sketchSelection).toEqual([points[1]]);
  });

  it('ignores selection of ids not in the active sketch', () => {
    const store = deterministicStore();
    drawRectangle(store);
    store.getState().toggleSketchEntitySelection('ghost');
    expect(store.getState().sketchSelection).toEqual([]);
  });

  it('ignores selection when not in sketch mode', () => {
    const store = deterministicStore();
    store.getState().toggleSketchEntitySelection('anything');
    expect(store.getState().sketchSelection).toEqual([]);
  });

  it('clears the selection when a drawing tool is activated', () => {
    const store = deterministicStore();
    const { points } = drawRectangle(store);
    store.getState().toggleSketchEntitySelection(points[0]!);
    store.getState().setSketchTool('line');
    expect(store.getState().sketchSelection).toEqual([]);
  });

  it('drops selection entries that no longer resolve after undo', () => {
    const store = deterministicStore();
    const { lines } = drawRectangle(store);
    store.getState().toggleSketchEntitySelection(lines[0]!);
    store.getState().undo(); // removes the rectangle geometry
    expect(store.getState().sketchSelection).toEqual([]);
  });
});

describe('applyConstraint', () => {
  it('applies a horizontal constraint through history and reports under-constrained', () => {
    const store = deterministicStore();
    const { lines } = drawRectangle(store);

    const outcome = store.getState().applyConstraint({ kind: 'horizontal', lineId: lines[0]! });

    expect(outcome.applied).toBe(true);
    expect(store.getState().sketchSolve?.status).toBe('under-constrained');
    expect(activeSketch(store).constraints).toHaveLength(1);
    expect(store.getState().canUndo).toBe(true);
  });

  it('fully constrains a dimensioned rectangle', () => {
    const store = deterministicStore();
    const { lines } = drawRectangle(store);

    constrainRectangle(store, lines);

    expect(activeSketch(store).constraints).toHaveLength(6);
    expect(store.getState().sketchSolve?.status).toBe('fully-constrained');
    expect(store.getState().sketchSolve?.remainingDof).toBe(0);
  });

  it('updates solved geometry deterministically without direct mutation', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    // Two points off-axis joined by a line; horizontal should level them.
    store.getState().setSketchTool('line');
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 0) });
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(10, 4) });
    store.getState().dispatchSketchEvent({ type: 'finish' });
    store.getState().setSketchTool(null);
    const line = entitiesOfKind(store, 'line')[0]!;

    store.getState().applyConstraint({ kind: 'horizontal', lineId: line.id });

    const points = entitiesOfKind(store, 'point');
    expect(points[0]!.y).toBeCloseTo(points[1]!.y, 6);
  });

  it('surfaces a contradictory constraint as conflicting without corrupting prior geometry', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('line');
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 0) });
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(10, 0) });
    store.getState().dispatchSketchEvent({ type: 'finish' });
    store.getState().setSketchTool(null);
    const [pa, pb] = entitiesOfKind(store, 'point');

    // Two contradictory distances on the same point pair.
    store.getState().applyConstraint({ kind: 'distance', pointA: pa!.id, pointB: pb!.id, value: 10 });
    const before = entitiesOfKind(store, 'point').map((p) => ({ x: p.x, y: p.y }));
    const outcome = store.getState().applyConstraint({ kind: 'distance', pointA: pa!.id, pointB: pb!.id, value: 25 });

    expect(store.getState().sketchSolve?.status).toBe('conflicting');
    expect(outcome.message).toBeTruthy();
    expect(store.getState().sketchSolve?.diagnostics.length).toBeGreaterThan(0);
    // Prior geometry coordinates are untouched by the failed solve.
    const after = entitiesOfKind(store, 'point').map((p) => ({ x: p.x, y: p.y }));
    expect(after).toEqual(before);
  });

  it('rolls the conflict back cleanly through undo', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('line');
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 0) });
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(10, 0) });
    store.getState().dispatchSketchEvent({ type: 'finish' });
    store.getState().setSketchTool(null);
    const [pa, pb] = entitiesOfKind(store, 'point');
    store.getState().applyConstraint({ kind: 'distance', pointA: pa!.id, pointB: pb!.id, value: 10 });
    store.getState().applyConstraint({ kind: 'distance', pointA: pa!.id, pointB: pb!.id, value: 25 });

    store.getState().undo();

    expect(activeSketch(store).constraints).toHaveLength(1);
    expect(store.getState().sketchSolve?.status).not.toBe('conflicting');
  });
});

describe('editConstraintValue', () => {
  it('edits a distance dimension and rebuilds geometry through history', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('line');
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 0) });
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(10, 0) });
    store.getState().dispatchSketchEvent({ type: 'finish' });
    store.getState().setSketchTool(null);
    const [pa, pb] = entitiesOfKind(store, 'point');
    store.getState().applyConstraint({ kind: 'distance', pointA: pa!.id, pointB: pb!.id, value: 10 });
    const distanceId = activeSketch(store).constraints[0]!.id;

    const outcome = store.getState().editConstraintValue(distanceId, 25);

    expect(outcome.applied).toBe(true);
    const constraint = activeSketch(store).constraints[0]!;
    expect(constraint.kind === 'distance' && constraint.value).toBe(25);
    const points = entitiesOfKind(store, 'point');
    expect(Math.hypot(points[1]!.x - points[0]!.x, points[1]!.y - points[0]!.y)).toBeCloseTo(25, 6);
  });

  it('rejects a non-positive distance value without committing', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('line');
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 0) });
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(10, 0) });
    store.getState().dispatchSketchEvent({ type: 'finish' });
    store.getState().setSketchTool(null);
    const [pa, pb] = entitiesOfKind(store, 'point');
    store.getState().applyConstraint({ kind: 'distance', pointA: pa!.id, pointB: pb!.id, value: 10 });
    const distanceId = activeSketch(store).constraints[0]!.id;
    const undoBefore = store.getState().canUndo;

    const outcome = store.getState().editConstraintValue(distanceId, -5);

    expect(outcome.applied).toBe(false);
    expect(outcome.message).toBeTruthy();
    const constraint = activeSketch(store).constraints[0]!;
    expect(constraint.kind === 'distance' && constraint.value).toBe(10);
    expect(store.getState().canUndo).toBe(undoBefore);
  });

  it('rejects an out-of-range angle value', () => {
    const store = deterministicStore();
    const { lines } = drawRectangle(store);
    store.getState().applyConstraint({ kind: 'angle', lineA: lines[0]!, lineB: lines[1]!, valueDeg: 90 });
    const angleId = activeSketch(store).constraints.find((c) => c.kind === 'angle')!.id;

    const outcome = store.getState().editConstraintValue(angleId, 200);

    expect(outcome.applied).toBe(false);
  });
});

describe('deleteConstraint', () => {
  it('removes a constraint through history and relaxes the status', () => {
    const store = deterministicStore();
    const { lines } = drawRectangle(store);
    constrainRectangle(store, lines);
    expect(store.getState().sketchSolve?.status).toBe('fully-constrained');
    const anyConstraint = activeSketch(store).constraints[0]!.id;

    store.getState().deleteConstraint(anyConstraint);

    expect(activeSketch(store).constraints).toHaveLength(5);
    expect(store.getState().sketchSolve?.status).toBe('under-constrained');
    expect(store.getState().canUndo).toBe(true);
  });

  it('clears the selected constraint when it is deleted', () => {
    const store = deterministicStore();
    const { lines } = drawRectangle(store);
    store.getState().applyConstraint({ kind: 'horizontal', lineId: lines[0]! });
    const id = activeSketch(store).constraints[0]!.id;
    store.getState().selectConstraint(id);

    store.getState().deleteConstraint(id);

    expect(store.getState().selectedConstraintId).toBeNull();
  });
});

describe('sketch solve status lifecycle', () => {
  it('starts a fresh sketch as under-constrained', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    expect(store.getState().sketchSolve?.status).toBe('under-constrained');
  });

  it('clears solve status and selection on finish', () => {
    const store = deterministicStore();
    drawRectangle(store);
    store.getState().finishSketch();
    expect(store.getState().sketchSolve).toBeNull();
    expect(store.getState().sketchSelection).toEqual([]);
    expect(store.getState().selectedConstraintId).toBeNull();
  });

  it('recomputes solve status after undo', () => {
    const store = deterministicStore();
    const { lines } = drawRectangle(store);
    constrainRectangle(store, lines);
    expect(store.getState().sketchSolve?.status).toBe('fully-constrained');
    store.getState().undo(); // removes the last distance constraint
    expect(store.getState().sketchSolve?.status).toBe('under-constrained');
  });
});
