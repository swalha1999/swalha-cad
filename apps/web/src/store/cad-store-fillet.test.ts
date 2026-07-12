import type { SketchEntity, SketchFeature } from '@swalha-cad/document';
import { detectSketchProfile } from '@swalha-cad/geometry';
import { describe, expect, it } from 'vitest';
import type { SnapResult } from '../sketch/tools/types.js';
import { createCadStore, selectActiveSketch } from './cad-store.js';

function deterministicStore() {
  let n = 0;
  return createCadStore(undefined, { createId: () => `id-${++n}` });
}
type Store = ReturnType<typeof deterministicStore>;

function freeSnap(x: number, y: number): SnapResult {
  return { point: { x, y }, ref: { kind: 'new', x, y }, kind: 'free' };
}
function clickAt(store: Store, x: number, y: number): void {
  store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(x, y) });
}
function activeSketch(store: Store): SketchFeature {
  const sketch = selectActiveSketch(store.getState());
  if (!sketch) throw new Error('expected an active sketch');
  return sketch;
}
function arcs(sketch: SketchFeature): Extract<SketchEntity, { kind: 'arc' }>[] {
  return sketch.entities.filter((e): e is Extract<SketchEntity, { kind: 'arc' }> => e.kind === 'arc');
}
function points(sketch: SketchFeature): Extract<SketchEntity, { kind: 'point' }>[] {
  return sketch.entities.filter((e): e is Extract<SketchEntity, { kind: 'point' }> => e.kind === 'point');
}
function pointAt(sketch: SketchFeature, x: number, y: number): boolean {
  return points(sketch).some((p) => Math.hypot(p.x - x, p.y - y) < 1e-6);
}

/** A 100×60 rectangle drawn corner-to-corner, with shared corner points. */
function buildRectangle(store: Store): void {
  store.getState().enterSketch('XY');
  store.getState().setSketchTool('rectangle');
  clickAt(store, 0, 0);
  clickAt(store, 100, 60);
  store.getState().setSketchTool(null);
}

/** Ids of the two rectangle edges incident to a corner coordinate. */
function edgesAtCorner(sketch: SketchFeature, x: number, y: number): string[] {
  const coord = new Map(points(sketch).map((p) => [p.id, [p.x, p.y] as const]));
  return sketch.entities
    .filter((e): e is Extract<SketchEntity, { kind: 'line' }> => e.kind === 'line')
    .filter((line) => {
      const a = coord.get(line.startId)!;
      const b = coord.get(line.endId)!;
      return (Math.hypot(a[0] - x, a[1] - y) < 1e-6) || (Math.hypot(b[0] - x, b[1] - y) < 1e-6);
    })
    .map((line) => line.id);
}

describe('startFillet — activation and mutual exclusivity', () => {
  it('command-first activation waits to pick two lines', () => {
    const store = deterministicStore();
    buildRectangle(store);
    store.getState().startFillet();
    expect(store.getState().sketch?.fillet).toEqual({ phase: 'picking', first: null, hover: null, note: null });
  });

  it('toggles off when re-invoked', () => {
    const store = deterministicStore();
    buildRectangle(store);
    store.getState().startFillet();
    store.getState().startFillet();
    expect(store.getState().sketch?.fillet).toBeNull();
  });

  it('selection-first: two selected lines jump straight to the radius editor', () => {
    const store = deterministicStore();
    buildRectangle(store);
    const ids = edgesAtCorner(activeSketch(store), 0, 0);
    store.getState().setSketchSelection(ids);
    store.getState().startFillet();
    const fillet = store.getState().sketch?.fillet;
    expect(fillet?.phase).toBe('awaiting');
    if (fillet?.phase === 'awaiting') {
      expect(fillet.radius).toBeGreaterThan(0);
      expect(fillet.suggested).toBe(fillet.radius);
    }
    // Selection is consumed on activation.
    expect(store.getState().sketchSelection).toEqual([]);
  });

  it('activating a modify tool clears an active fillet, and vice versa', () => {
    const store = deterministicStore();
    buildRectangle(store);
    store.getState().startFillet();
    store.getState().setSketchModifyTool('trim');
    expect(store.getState().sketch?.fillet).toBeNull();
    store.getState().startFillet();
    expect(store.getState().sketch?.modify).toBeNull();
  });
});

describe('filletPickLine — command-first picking', () => {
  it('records the first line then advances to awaiting on a second, distinct line', () => {
    const store = deterministicStore();
    buildRectangle(store);
    store.getState().startFillet();
    store.getState().filletPickLine({ x: 50, y: 0 }); // bottom edge
    let fillet = store.getState().sketch?.fillet;
    expect(fillet?.phase).toBe('picking');
    if (fillet?.phase === 'picking') expect(fillet.first?.lineId).toBeTruthy();

    store.getState().filletPickLine({ x: 0, y: 30 }); // left edge
    fillet = store.getState().sketch?.fillet;
    expect(fillet?.phase).toBe('awaiting');
  });

  it('ignores a click far from any line and a repeat of the same line', () => {
    const store = deterministicStore();
    buildRectangle(store);
    store.getState().startFillet();
    store.getState().filletPickLine({ x: 50, y: 40 }); // interior — no line near
    expect(store.getState().sketch?.fillet).toMatchObject({ phase: 'picking', first: null });
    store.getState().filletPickLine({ x: 50, y: 0 });
    store.getState().filletPickLine({ x: 60, y: 0 }); // same bottom edge again
    expect(store.getState().sketch?.fillet?.phase).toBe('picking');
  });
});

describe('commitFillet — one transaction, geometry, and persistence', () => {
  function toAwaiting(store: Store): void {
    buildRectangle(store);
    store.getState().startFillet();
    store.getState().filletPickLine({ x: 50, y: 0 });
    store.getState().filletPickLine({ x: 0, y: 30 });
  }

  it('creates the tangent arc, trims both edges, removes the corner point, and stays active', () => {
    const store = deterministicStore();
    toAwaiting(store);
    const outcome = store.getState().commitFillet(7.5);
    expect(outcome.applied).toBe(true);

    const sketch = activeSketch(store);
    expect(arcs(sketch)).toHaveLength(1);
    expect(arcs(sketch)[0]!.radius).toBeCloseTo(7.5, 9);
    // Tangent points on each edge; the old corner (0,0) is gone.
    expect(pointAt(sketch, 7.5, 0)).toBe(true);
    expect(pointAt(sketch, 0, 7.5)).toBe(true);
    expect(pointAt(sketch, 0, 0)).toBe(false);
    // Watertight, extrudable profile.
    const profile = detectSketchProfile(sketch);
    expect(profile.ok).toBe(true);
    if (profile.ok) expect(profile.profile.kind).toBe('curve-loop');
    // The tool remains active for the next fillet.
    expect(store.getState().sketch?.fillet?.phase).toBe('picking');
  });

  it('is exactly one undoable history step, restoring exact ids and geometry', () => {
    const store = deterministicStore();
    toAwaiting(store);
    const before = JSON.stringify(activeSketch(store));
    store.getState().commitFillet(7.5);
    const after = JSON.stringify(activeSketch(store));
    expect(store.getState().canUndo).toBe(true);

    store.getState().undo();
    expect(JSON.stringify(activeSketch(store))).toBe(before);
    store.getState().redo();
    expect(JSON.stringify(activeSketch(store))).toBe(after);
  });

  it('rejects an invalid radius without mutating the document', () => {
    const store = deterministicStore();
    toAwaiting(store);
    const before = JSON.stringify(activeSketch(store));
    const outcome = store.getState().commitFillet(0);
    expect(outcome.applied).toBe(false);
    expect(JSON.stringify(activeSketch(store))).toBe(before);
    // Still awaiting so the value can be corrected.
    expect(store.getState().sketch?.fillet?.phase).toBe('awaiting');
  });

  it('rejects an oversized radius with a diagnostic', () => {
    const store = deterministicStore();
    toAwaiting(store);
    const outcome = store.getState().commitFillet(1000);
    expect(outcome.applied).toBe(false);
    expect(outcome.message).toMatch(/too large/i);
  });
});

describe('cancelFillet — layered escape', () => {
  it('awaiting → picking → first cleared → tool exit', () => {
    const store = deterministicStore();
    buildRectangle(store);
    store.getState().startFillet();
    store.getState().filletPickLine({ x: 50, y: 0 });
    store.getState().filletPickLine({ x: 0, y: 30 });
    expect(store.getState().sketch?.fillet?.phase).toBe('awaiting');

    store.getState().cancelFillet(); // awaiting → picking (cleared)
    expect(store.getState().sketch?.fillet).toMatchObject({ phase: 'picking', first: null });

    store.getState().filletPickLine({ x: 50, y: 0 }); // set a first pick again
    store.getState().cancelFillet(); // first → cleared
    expect(store.getState().sketch?.fillet).toMatchObject({ phase: 'picking', first: null });

    store.getState().cancelFillet(); // empty picking → exit
    expect(store.getState().sketch?.fillet).toBeNull();
  });
});
