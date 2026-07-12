import type { SketchFeature } from '@swalha-cad/document';
import { parseCadDocument } from '@swalha-cad/document';
import { detectSketchProfile } from '@swalha-cad/geometry';
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

function existingSnap(id: string, x: number, y: number): SnapResult {
  return { point: { x, y }, ref: { kind: 'existing', id }, kind: 'endpoint' };
}

function activeSketch(store: ReturnType<typeof deterministicStore>): SketchFeature {
  const sketch = selectActiveSketch(store.getState());
  if (!sketch) throw new Error('expected an active sketch');
  return sketch;
}

function clickAt(store: ReturnType<typeof deterministicStore>, x: number, y: number): void {
  store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(x, y) });
}

describe('three-point arc through the store', () => {
  it('commits one arc referencing a new center point, and undo/redo round-trips it', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('arc-3point');

    clickAt(store, 5, 0);
    clickAt(store, -5, 0);
    clickAt(store, 0, 5);

    const arcs = activeSketch(store).entities.filter((e) => e.kind === 'arc');
    expect(arcs).toHaveLength(1);
    const arc = arcs[0]!;
    if (arc.kind !== 'arc') throw new Error('unreachable');
    expect(arc.radius).toBeCloseTo(5, 9);
    expect(activeSketch(store).entities.some((e) => e.id === arc.centerId && e.kind === 'point')).toBe(true);

    store.getState().undo();
    expect(activeSketch(store).entities.filter((e) => e.kind === 'arc')).toHaveLength(0);
    store.getState().redo();
    expect(activeSketch(store).entities.filter((e) => e.kind === 'arc')).toHaveLength(1);
  });

  it('does not mutate the sketch for a collinear third point', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('arc-3point');
    clickAt(store, 0, 0);
    clickAt(store, 4, 4);
    clickAt(store, 2, 2); // collinear — rejected
    expect(activeSketch(store).entities).toHaveLength(0);
  });
});

describe('tangent arc continuity through the store', () => {
  it('seeds the tangent from a line endpoint so the arc continues smoothly', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    // Draw a horizontal line first.
    store.getState().setSketchTool('line');
    clickAt(store, 0, 0);
    clickAt(store, 10, 0);
    store.getState().dispatchSketchEvent({ type: 'finish' });

    const endPoint = activeSketch(store).entities.find((e) => e.kind === 'point' && e.x === 10 && e.y === 0)!;

    store.getState().setSketchTool('arc-tangent');
    // First click snaps onto the line's end point: the store injects the tangent.
    store.getState().dispatchSketchEvent({ type: 'click', snap: existingSnap(endPoint.id, 10, 0) });
    expect(store.getState().sketch?.toolState).toMatchObject({ tool: 'arc-tangent', tangent: { x: 1, y: 0 } });

    // Second click ends the arc above the line.
    clickAt(store, 10, 4);
    const arcs = activeSketch(store).entities.filter((e) => e.kind === 'arc');
    expect(arcs).toHaveLength(1);
  });

  it('leaves the tangent unseeded and refuses to build when the start is on empty space', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('arc-tangent');
    clickAt(store, 0, 0); // free space — no incident line
    expect(store.getState().sketch?.toolState).toMatchObject({ tangent: null });
    clickAt(store, 0, 4); // cannot build without a tangent
    expect(activeSketch(store).entities.filter((e) => e.kind === 'arc')).toHaveLength(0);
  });
});

describe('slot through the store', () => {
  it('commits two lines and two arcs, persisting through save/reload', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('slot');
    clickAt(store, 0, 0);
    clickAt(store, 20, 0);
    clickAt(store, 10, 3); // width click

    const entities = activeSketch(store).entities;
    expect(entities.filter((e) => e.kind === 'line')).toHaveLength(2);
    expect(entities.filter((e) => e.kind === 'arc')).toHaveLength(2);

    // Reload through the versioned schema to prove the arcs survive serialisation.
    const reparsed = parseCadDocument(JSON.parse(JSON.stringify(store.getState().document)));
    expect(reparsed.success).toBe(true);
    if (!reparsed.success) return;
    store.getState().loadDocument(reparsed.data);
    const reloaded = reparsed.data.features.find((f): f is SketchFeature => f.kind === 'sketch')!;
    expect(reloaded.entities.filter((e) => e.kind === 'arc')).toHaveLength(2);
  });
});

describe('arc profile diagnostics through the store', () => {
  it('reports an explicit unsupported-arc diagnostic instead of a valid profile', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('arc-3point');
    clickAt(store, 5, 0);
    clickAt(store, -5, 0);
    clickAt(store, 0, 5);

    const result = detectSketchProfile(activeSketch(store));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.kind)).toContain('unsupported-arc');
  });
});
