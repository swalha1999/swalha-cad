import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SnapResult } from './tools/types.js';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore, selectActiveSketch } from '../store/cad-store.js';
import { MirrorPanel } from './MirrorPanel.js';

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

/** Draws an open half-profile chain touching x = 0 at both ends, plus a construction axis on x = 0. */
function buildHalfProfile(store: Store): { sourceLineIds: string[] } {
  store.getState().enterSketch('XY');
  store.getState().setSketchTool('line');
  clickAt(store, 0, 0);
  clickAt(store, 30, 10);
  clickAt(store, 30, 30);
  clickAt(store, 0, 40);
  store.getState().dispatchSketchEvent({ type: 'finish' });
  store.getState().setSketchTool(null);
  store.getState().setSketchConstruction(true);
  store.getState().setSketchTool('line');
  clickAt(store, 0, -10);
  clickAt(store, 0, 50);
  store.getState().dispatchSketchEvent({ type: 'finish' });
  store.getState().setSketchTool(null);
  store.getState().setSketchConstruction(false);
  const sketch = selectActiveSketch(store.getState())!;
  const sourceLineIds = sketch.entities.filter((e) => e.kind === 'line' && !e.construction).map((e) => e.id);
  return { sourceLineIds };
}

function renderPanel(store: Store) {
  render(
    <CadStoreProvider store={store}>
      <MirrorPanel />
    </CadStoreProvider>,
  );
}

describe('MirrorPanel', () => {
  it('renders nothing when the Mirror tool is inactive', () => {
    const store = deterministicStore();
    store.getState().enterSketch('XY');
    renderPanel(store);
    expect(screen.queryByRole('group', { name: 'Mirror' })).toBeNull();
  });

  it('shows the source collector with a disabled "Choose axis" until a source is picked', () => {
    const store = deterministicStore();
    buildHalfProfile(store);
    store.getState().startMirror();
    renderPanel(store);
    expect(screen.getByRole('group', { name: 'Mirror' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose axis' })).toBeDisabled();
  });

  it('advances through axis to confirm, and confirms the mirror as one edit', () => {
    const store = deterministicStore();
    const { sourceLineIds } = buildHalfProfile(store);
    store.getState().startMirror();
    for (const id of sourceLineIds) store.getState().mirrorToggleSource(id);
    renderPanel(store);

    fireEvent.click(screen.getByRole('button', { name: 'Choose axis' }));
    expect(store.getState().sketch?.mirror?.phase).toBe('axis');

    act(() => store.getState().mirrorPickAxis({ x: 0, y: 20 }));
    expect(store.getState().sketch?.mirror?.phase).toBe('confirm');

    const before = selectActiveSketch(store.getState())!.entities.filter((e) => e.kind === 'line').length;
    fireEvent.click(screen.getByRole('button', { name: 'Confirm mirror' }));
    const after = selectActiveSketch(store.getState())!.entities.filter((e) => e.kind === 'line').length;
    expect(after).toBe(before + 3);
    expect(store.getState().canUndo).toBe(true);
  });

  it('Cancel steps back one layer at a time', () => {
    const store = deterministicStore();
    const { sourceLineIds } = buildHalfProfile(store);
    store.getState().setSketchSelection(sourceLineIds);
    store.getState().startMirror();
    store.getState().mirrorPickAxis({ x: 0, y: 20 });
    expect(store.getState().sketch?.mirror?.phase).toBe('confirm');
    renderPanel(store);
    expect(screen.getByRole('button', { name: 'Confirm mirror' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel mirror' }));
    expect(store.getState().sketch?.mirror?.phase).toBe('axis');
  });
});
