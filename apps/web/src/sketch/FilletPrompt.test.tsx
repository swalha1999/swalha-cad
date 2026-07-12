import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SnapResult } from './tools/types.js';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore, selectActiveSketch } from '../store/cad-store.js';
import { FilletPrompt } from './FilletPrompt.js';

function freeSnap(x: number, y: number): SnapResult {
  return { point: { x, y }, ref: { kind: 'new', x, y }, kind: 'free' };
}
type Store = ReturnType<typeof createCadStore>;

/** A store with a rectangle whose bottom-left corner has the Fillet tool awaiting a radius. */
function awaitingStore(): Store {
  let n = 0;
  const store = createCadStore(undefined, { createId: () => `id-${++n}` });
  store.getState().enterSketch('XY');
  store.getState().setSketchTool('rectangle');
  store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 0) });
  store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(100, 60) });
  store.getState().setSketchTool(null);
  store.getState().startFillet();
  store.getState().filletPickLine({ x: 50, y: 0 });
  store.getState().filletPickLine({ x: 0, y: 30 });
  return store;
}

function currentRadius(store: Store): number {
  const fillet = store.getState().sketch!.fillet;
  if (fillet?.phase !== 'awaiting') throw new Error('expected an awaiting fillet');
  return fillet.radius;
}

function renderPrompt(store: Store) {
  render(
    <CadStoreProvider store={store}>
      <FilletPrompt radius={currentRadius(store)} />
    </CadStoreProvider>,
  );
}

function arcCount(store: Store): number {
  return selectActiveSketch(store.getState())!.entities.filter((e) => e.kind === 'arc').length;
}

describe('FilletPrompt', () => {
  it('prefills the suggested radius in mm and focuses the input', () => {
    const store = awaitingStore();
    renderPrompt(store);
    const input = screen.getByLabelText('Fillet radius');
    expect(input).toHaveValue(String(currentRadius(store)));
    expect(input).toHaveFocus();
    expect(screen.getByText('mm')).toBeInTheDocument();
  });

  it('commits the typed radius on Enter, creating the tangent arc and staying active', () => {
    const store = awaitingStore();
    renderPrompt(store);
    const input = screen.getByLabelText('Fillet radius');
    fireEvent.change(input, { target: { value: '7.5' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(arcCount(store)).toBe(1);
    const arc = selectActiveSketch(store.getState())!.entities.find((e) => e.kind === 'arc')!;
    expect(arc.kind === 'arc' && arc.radius).toBeCloseTo(7.5, 6);
    // The tool persists for the next fillet.
    expect(store.getState().sketch!.fillet?.phase).toBe('picking');
  });

  it('updates the live radius as the value is typed (drives the preview)', () => {
    const store = awaitingStore();
    renderPrompt(store);
    fireEvent.change(screen.getByLabelText('Fillet radius'), { target: { value: '9' } });
    expect(currentRadius(store)).toBe(9);
  });

  it('cancels on Escape without mutating the document', () => {
    const store = awaitingStore();
    const before = store.getState().document;
    renderPrompt(store);
    fireEvent.keyDown(screen.getByLabelText('Fillet radius'), { key: 'Escape' });
    expect(store.getState().document).toBe(before);
    expect(arcCount(store)).toBe(0);
  });

  it('shows an inline error and keeps awaiting when the radius is rejected', () => {
    const store = awaitingStore();
    const before = store.getState().document;
    renderPrompt(store);
    const input = screen.getByLabelText('Fillet radius');
    fireEvent.change(input, { target: { value: '1000' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(store.getState().document).toBe(before);
    expect(store.getState().sketch!.fillet?.phase).toBe('awaiting');
  });
});
