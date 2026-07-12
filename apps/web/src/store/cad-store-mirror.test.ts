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
function lines(sketch: SketchFeature): Extract<SketchEntity, { kind: 'line' }>[] {
  return sketch.entities.filter((e): e is Extract<SketchEntity, { kind: 'line' }> => e.kind === 'line');
}
function points(sketch: SketchFeature): Extract<SketchEntity, { kind: 'point' }>[] {
  return sketch.entities.filter((e): e is Extract<SketchEntity, { kind: 'point' }> => e.kind === 'point');
}
function coordOf(sketch: SketchFeature, id: string): [number, number] {
  const p = points(sketch).find((e) => e.id === id)!;
  return [p.x, p.y];
}
/** The id of a non-construction line whose two endpoints match the given coords (order-independent). */
function lineBetween(sketch: SketchFeature, a: [number, number], b: [number, number]): string | null {
  for (const line of lines(sketch)) {
    const s = coordOf(sketch, line.startId);
    const e = coordOf(sketch, line.endId);
    const match =
      (Math.hypot(s[0] - a[0], s[1] - a[1]) < 1e-6 && Math.hypot(e[0] - b[0], e[1] - b[1]) < 1e-6) ||
      (Math.hypot(s[0] - b[0], s[1] - b[1]) < 1e-6 && Math.hypot(e[0] - a[0], e[1] - a[1]) < 1e-6);
    if (match) return line.id;
  }
  return null;
}

/** Draws an open half-profile chain touching the vertical centerline (x = 0) at both ends, plus a construction axis on x = 0. */
function buildHalfProfile(store: Store): { sourceLineIds: string[]; axisId: string } {
  store.getState().enterSketch('XY');
  // Open chain: (0,0) → (30,10) → (30,30) → (0,40). Both free ends lie on x = 0.
  store.getState().setSketchTool('line');
  clickAt(store, 0, 0);
  clickAt(store, 30, 10);
  clickAt(store, 30, 30);
  clickAt(store, 0, 40);
  store.getState().dispatchSketchEvent({ type: 'finish' });
  store.getState().setSketchTool(null);
  // Construction centerline on x = 0.
  store.getState().setSketchConstruction(true);
  store.getState().setSketchTool('line');
  clickAt(store, 0, -10);
  clickAt(store, 0, 50);
  store.getState().dispatchSketchEvent({ type: 'finish' });
  store.getState().setSketchTool(null);
  store.getState().setSketchConstruction(false);

  const sketch = activeSketch(store);
  const sourceLineIds = [
    lineBetween(sketch, [0, 0], [30, 10])!,
    lineBetween(sketch, [30, 10], [30, 30])!,
    lineBetween(sketch, [30, 30], [0, 40])!,
  ];
  const axisId = lines(sketch).find((l) => l.construction)!.id;
  return { sourceLineIds, axisId };
}

describe('startMirror — activation and role inference', () => {
  it('command-first activation starts the source collector', () => {
    const store = deterministicStore();
    buildHalfProfile(store);
    store.getState().startMirror();
    expect(store.getState().sketch?.mirror).toEqual({ phase: 'sources', sourceIds: [], hover: null, note: null });
  });

  it('toggles off when re-invoked', () => {
    const store = deterministicStore();
    buildHalfProfile(store);
    store.getState().startMirror();
    store.getState().startMirror();
    expect(store.getState().sketch?.mirror).toBeNull();
  });

  it('selection-first: sources plus exactly one line infer the axis and jump to confirm', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    // A circle source and a single line (the axis).
    store.getState().setSketchTool('circle');
    clickAt(store, 20, 0);
    clickAt(store, 25, 0); // radius 5
    store.getState().setSketchTool('line');
    clickAt(store, 0, -10);
    clickAt(store, 0, 10);
    store.getState().dispatchSketchEvent({ type: 'finish' });
    store.getState().setSketchTool(null);
    const sketch = activeSketch(store);
    const circleId = sketch.entities.find((e) => e.kind === 'circle')!.id;
    const axisId = lines(sketch)[0]!.id;
    store.getState().setSketchSelection([circleId, axisId]);
    store.getState().startMirror();
    expect(store.getState().sketch?.mirror).toEqual({ phase: 'confirm', sourceIds: [circleId], axisId, note: null });
  });

  it('ambiguous: multiple selected lines lock as sources and collect the axis with a note', () => {
    const store = deterministicStore();
    const { sourceLineIds } = buildHalfProfile(store);
    store.getState().setSketchSelection(sourceLineIds);
    store.getState().startMirror();
    const mirror = store.getState().sketch?.mirror;
    expect(mirror?.phase).toBe('axis');
    if (mirror?.phase === 'axis') {
      expect(mirror.sourceIds).toEqual(sourceLineIds);
      expect(mirror.note).toMatch(/mirror axis/i);
    }
  });
});

describe('mirror collector — sources, axis, confirm', () => {
  it('collects sources, advances to axis, picks the axis, and confirms one undoable edit', () => {
    const store = deterministicStore();
    const { sourceLineIds } = buildHalfProfile(store);
    const before = lines(activeSketch(store)).length;

    store.getState().startMirror();
    for (const id of sourceLineIds) store.getState().mirrorToggleSource(id);
    expect((store.getState().sketch?.mirror as { sourceIds: string[] }).sourceIds).toEqual(sourceLineIds);

    store.getState().mirrorChooseAxis();
    expect(store.getState().sketch?.mirror?.phase).toBe('axis');

    // Click near the centerline (x = 0) to pick it as the axis.
    store.getState().mirrorPickAxis({ x: 0, y: 20 });
    expect(store.getState().sketch?.mirror?.phase).toBe('confirm');

    const outcome = store.getState().confirmMirror();
    expect(outcome.applied).toBe(true);
    // Three mirrored lines added.
    expect(lines(activeSketch(store)).length).toBe(before + 3);
    // Persistent tool returns to the empty source collector.
    expect(store.getState().sketch?.mirror).toEqual({ phase: 'sources', sourceIds: [], hover: null, note: null });
    expect(store.getState().canUndo).toBe(true);
  });

  it('the mirrored half closes the profile into one extrudable loop', () => {
    const store = deterministicStore();
    const { sourceLineIds } = buildHalfProfile(store);
    store.getState().setSketchSelection(sourceLineIds);
    store.getState().startMirror(); // → axis phase (ambiguous multi-line)
    store.getState().mirrorPickAxis({ x: 0, y: 20 });
    store.getState().confirmMirror();

    const profile = detectSketchProfile(activeSketch(store));
    expect(profile.ok).toBe(true);
    // Six edges around the closed hexagon.
    expect(lines(activeSketch(store)).filter((l) => !l.construction)).toHaveLength(6);
  });

  it('undo removes the mirror, redo restores it', () => {
    const store = deterministicStore();
    const { sourceLineIds } = buildHalfProfile(store);
    const before = lines(activeSketch(store)).length;
    store.getState().setSketchSelection(sourceLineIds);
    store.getState().startMirror();
    store.getState().mirrorPickAxis({ x: 0, y: 20 });
    store.getState().confirmMirror();
    const after = lines(activeSketch(store)).length;
    expect(after).toBe(before + 3);

    store.getState().undo();
    expect(lines(activeSketch(store)).length).toBe(before);
    store.getState().redo();
    expect(lines(activeSketch(store)).length).toBe(after);
  });

  it('never mutates the source lines: their endpoints are unchanged after mirroring', () => {
    const store = deterministicStore();
    const { sourceLineIds } = buildHalfProfile(store);
    const sketchBefore = activeSketch(store);
    const sourceSig = sourceLineIds.map((id) => JSON.stringify(sketchBefore.entities.find((e) => e.id === id)));
    store.getState().setSketchSelection(sourceLineIds);
    store.getState().startMirror();
    store.getState().mirrorPickAxis({ x: 0, y: 20 });
    store.getState().confirmMirror();
    const sketchAfter = activeSketch(store);
    const sourceSigAfter = sourceLineIds.map((id) => JSON.stringify(sketchAfter.entities.find((e) => e.id === id)));
    expect(sourceSigAfter).toEqual(sourceSig);
  });
});

describe('cancelMirror — layered', () => {
  it('confirm → axis → sources(cleared) → exit', () => {
    const store = deterministicStore();
    const { sourceLineIds } = buildHalfProfile(store);
    store.getState().setSketchSelection(sourceLineIds);
    store.getState().startMirror();
    store.getState().mirrorPickAxis({ x: 0, y: 20 });
    expect(store.getState().sketch?.mirror?.phase).toBe('confirm');

    store.getState().cancelMirror();
    expect(store.getState().sketch?.mirror?.phase).toBe('axis');
    store.getState().cancelMirror();
    expect(store.getState().sketch?.mirror?.phase).toBe('sources');
    // Sources still present after stepping back from axis → first cancel clears them, second exits.
    store.getState().cancelMirror();
    store.getState().cancelMirror();
    expect(store.getState().sketch?.mirror).toBeNull();
  });
});

describe('mirror — mutual exclusivity with other tools', () => {
  it('starting Mirror leaves any Fillet, and starting Fillet leaves Mirror', () => {
    const store = deterministicStore();
    buildHalfProfile(store);
    store.getState().startFillet();
    expect(store.getState().sketch?.fillet).not.toBeNull();
    store.getState().startMirror();
    expect(store.getState().sketch?.fillet).toBeNull();
    expect(store.getState().sketch?.mirror).not.toBeNull();
    store.getState().startFillet();
    expect(store.getState().sketch?.mirror).toBeNull();
    expect(store.getState().sketch?.fillet).not.toBeNull();
  });

  it('activating a drawing tool leaves Mirror', () => {
    const store = deterministicStore();
    buildHalfProfile(store);
    store.getState().startMirror();
    store.getState().setSketchTool('line');
    expect(store.getState().sketch?.mirror).toBeNull();
  });
});
