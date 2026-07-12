import type { SketchFeature } from '@swalha-cad/document';
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

function activeSketch(store: ReturnType<typeof deterministicStore>): SketchFeature {
  const sketch = selectActiveSketch(store.getState());
  if (!sketch) throw new Error('expected an active sketch');
  return sketch;
}

function clickAt(store: ReturnType<typeof deterministicStore>, x: number, y: number): void {
  store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(x, y) });
}

describe('center rectangle through the store', () => {
  it('commits four symmetric corners at continuous coordinates', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('rectangle-center');

    clickAt(store, 3.7, 2.1); // center
    clickAt(store, 7.7, 5.1); // corner

    const points = activeSketch(store).entities.filter((e) => e.kind === 'point');
    const lines = activeSketch(store).entities.filter((e) => e.kind === 'line');
    expect(points).toHaveLength(4);
    expect(lines).toHaveLength(4);
    // Corners are symmetric about the center (3.7, 2.1).
    const xs = points.map((p) => (p.kind === 'point' ? p.x : 0)).sort((a, b) => a - b);
    expect(xs[0]! + xs[3]!).toBeCloseTo(2 * 3.7, 9);
  });
});

describe('3-point rectangle through the store', () => {
  it('commits a closed loop forming a valid extrude profile', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('rectangle-3point');

    clickAt(store, 0, 0);
    clickAt(store, 12.5, 0);
    clickAt(store, 6, 4.5);

    const entities = activeSketch(store).entities;
    expect(entities.filter((e) => e.kind === 'line')).toHaveLength(4);
    const profile = detectSketchProfile(activeSketch(store));
    expect(profile.ok).toBe(true);
  });
});

describe('3-point circle through the store', () => {
  it('commits a circle whose center is the circumcenter', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('circle-3point');

    clickAt(store, 5, 0);
    clickAt(store, 0, 5);
    clickAt(store, -5, 0);

    const circles = activeSketch(store).entities.filter((e) => e.kind === 'circle');
    expect(circles).toHaveLength(1);
    const circle = circles[0]!;
    if (circle.kind !== 'circle') throw new Error('unreachable');
    expect(circle.radius).toBeCloseTo(5, 9);
    const center = activeSketch(store).entities.find((e) => e.id === circle.centerId);
    if (center?.kind !== 'point') throw new Error('expected a center point');
    expect(center.x).toBeCloseTo(0, 9);
    expect(center.y).toBeCloseTo(0, 9);
  });

  it('does not mutate the sketch when the three points are collinear', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('circle-3point');

    clickAt(store, 0, 0);
    clickAt(store, 5, 5);
    clickAt(store, 10, 10); // collinear third point — rejected

    expect(activeSketch(store).entities).toHaveLength(0);
    expect(store.getState().canUndo).toBe(true); // only the sketch feature.create
  });
});

describe('regular polygon through the store', () => {
  it('seeds the polygon tool with the session side count and commits a closed loop', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchPolygonSides(5);
    store.getState().setSketchTool('polygon');
    expect(store.getState().sketch?.toolState).toMatchObject({ tool: 'polygon', sides: 5 });

    clickAt(store, 0, 0);
    clickAt(store, 4, 0);

    const entities = activeSketch(store).entities;
    expect(entities.filter((e) => e.kind === 'point')).toHaveLength(5);
    expect(entities.filter((e) => e.kind === 'line')).toHaveLength(5);
  });

  it('updates an active polygon tool when the side count changes mid-tool', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('polygon');
    store.getState().setSketchPolygonSides(8);
    expect(store.getState().sketch?.toolState).toMatchObject({ tool: 'polygon', sides: 8 });
    expect(store.getState().sketch?.polygonSides).toBe(8);
  });

  it('clamps the side count to at least three', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchPolygonSides(1);
    expect(store.getState().sketch?.polygonSides).toBe(3);
  });
});

describe('construction toggle', () => {
  it('flips the mode for new geometry when nothing is selected', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().toggleConstruction();
    expect(store.getState().sketch?.construction).toBe(true);
    store.getState().toggleConstruction();
    expect(store.getState().sketch?.construction).toBe(false);
  });

  it('toggles selected existing geometry to construction through history', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('rectangle');
    clickAt(store, 0, 0);
    clickAt(store, 20, 10);
    store.getState().setSketchTool(null);

    const lineIds = activeSketch(store)
      .entities.filter((e) => e.kind === 'line')
      .map((e) => e.id);
    store.getState().setSketchSelection(lineIds);
    store.getState().toggleConstruction();

    const lines = activeSketch(store).entities.filter((e) => e.kind === 'line');
    expect(lines.every((e) => e.construction)).toBe(true);
    // The mode itself did not change — only the selection was affected.
    expect(store.getState().sketch?.construction).toBe(false);

    // Undo restores the non-construction lines.
    store.getState().undo();
    expect(activeSketch(store).entities.filter((e) => e.kind === 'line').every((e) => e.construction)).toBe(false);
  });

  it('excludes toggled construction geometry from the extrude profile', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('rectangle');
    clickAt(store, 0, 0);
    clickAt(store, 20, 10);
    store.getState().setSketchTool(null);

    // A valid line-loop profile before toggling.
    expect(detectSketchProfile(activeSketch(store)).ok).toBe(true);

    const allIds = activeSketch(store).entities.map((e) => e.id);
    store.getState().setSketchSelection(allIds);
    store.getState().toggleConstruction();

    // Once every entity is construction, no profile geometry remains.
    expect(detectSketchProfile(activeSketch(store)).ok).toBe(false);
  });
});
