import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SnapResult } from './tools/types.js';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore, selectActiveSketch } from '../store/cad-store.js';
import { DimensionPrompt } from './DimensionPrompt.js';

function freeSnap(x: number, y: number): SnapResult {
  return { point: { x, y }, ref: { kind: 'new', x, y }, kind: 'free' };
}

type Store = ReturnType<typeof createCadStore>;

/** A store in XY sketch mode with one free line, the Distance tool awaiting a value on it. */
function awaitingStore(): Store {
  let n = 0;
  const store = createCadStore(undefined, { createId: () => `id-${++n}` });
  store.getState().enterSketch('XY');
  store.getState().setSketchTool('line');
  store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(3, 7) });
  store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(33, 47) });
  store.getState().dispatchSketchEvent({ type: 'finish' });
  store.getState().setSketchTool(null);
  const line = selectActiveSketch(store.getState())!.entities.find((e) => e.kind === 'line')!;
  store.getState().setSketchSelection([line.id]);
  store.getState().startDimension();
  return store;
}

function measured(store: Store): number {
  const dimension = store.getState().sketch!.dimension;
  if (dimension?.phase !== 'awaiting') throw new Error('expected an awaiting dimension');
  return dimension.measured;
}

function renderPrompt(store: Store) {
  render(
    <CadStoreProvider store={store}>
      <DimensionPrompt measured={measured(store)} />
    </CadStoreProvider>,
  );
}

function distance(store: Store): number {
  const points = selectActiveSketch(store.getState())!.entities.filter((e) => e.kind === 'point');
  return Math.hypot(points[1]!.x - points[0]!.x, points[1]!.y - points[0]!.y);
}

describe('DimensionPrompt', () => {
  it('prefills the input with the measured length in mm and focuses it', () => {
    const store = awaitingStore();
    renderPrompt(store);

    const input = screen.getByLabelText('Dimension value');
    expect(input).toHaveValue('50');
    expect(input).toHaveFocus();
    expect(screen.getByText('mm')).toBeInTheDocument();
  });

  it('commits the typed value on Enter, solving the geometry and closing the tool', () => {
    const store = awaitingStore();
    renderPrompt(store);

    const input = screen.getByLabelText('Dimension value');
    fireEvent.change(input, { target: { value: '42.5' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const constraint = selectActiveSketch(store.getState())!.constraints[0]!;
    expect(constraint.kind === 'distance' && constraint.value).toBe(42.5);
    expect(distance(store)).toBeCloseTo(42.5, 6);
    expect(store.getState().sketch!.dimension).toBeNull();
  });

  it('cancels on Escape without mutating the document', () => {
    const store = awaitingStore();
    const before = store.getState().document;
    renderPrompt(store);

    fireEvent.keyDown(screen.getByLabelText('Dimension value'), { key: 'Escape' });

    expect(store.getState().sketch!.dimension).toBeNull();
    expect(store.getState().document).toBe(before);
  });

  it('shows an inline error and keeps awaiting when the value is rejected', () => {
    const store = awaitingStore();
    const before = store.getState().document;
    renderPrompt(store);

    const input = screen.getByLabelText('Dimension value');
    fireEvent.change(input, { target: { value: '-5' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(store.getState().document).toBe(before);
    expect(store.getState().sketch!.dimension?.phase).toBe('awaiting');
  });
});
