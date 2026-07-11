import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SnapResult } from './tools/types.js';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore } from '../store/cad-store.js';
import { SketchOverlay } from './SketchOverlay.js';

function freeSnap(x: number, y: number): SnapResult {
  return { point: { x, y }, ref: { kind: 'new', x, y }, kind: 'grid' };
}

function renderOverlay(store = createCadStore()) {
  render(
    <CadStoreProvider store={store}>
      <SketchOverlay />
    </CadStoreProvider>,
  );
  return store;
}

describe('SketchOverlay', () => {
  it('renders an accessible sketch canvas with a grid and origin axes', () => {
    const store = createCadStore();
    store.getState().enterSketch('XY');
    const { container } = render(
      <CadStoreProvider store={store}>
        <SketchOverlay />
      </CadStoreProvider>,
    );

    expect(screen.getByRole('img', { name: 'Sketch canvas' })).toBeInTheDocument();
    expect(container.querySelector('.sketch-overlay__grid')).not.toBeNull();
    expect(container.querySelector('.sketch-overlay__axis--x')).not.toBeNull();
    expect(container.querySelector('.sketch-overlay__axis--y')).not.toBeNull();
  });

  it('draws committed lines and circles from the active sketch feature', () => {
    const store = createCadStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('rectangle');
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 0) });
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(40, 30) });
    store.getState().setSketchTool('circle');
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 0) });
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 20) });

    const { container } = render(
      <CadStoreProvider store={store}>
        <SketchOverlay />
      </CadStoreProvider>,
    );

    expect(container.querySelectorAll('.sketch-overlay__line')).toHaveLength(4);
    expect(container.querySelectorAll('.sketch-overlay__circle')).toHaveLength(1);
  });

  it('styles construction geometry distinctly from normal geometry', () => {
    const store = createCadStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchConstruction(true);
    store.getState().setSketchTool('circle');
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 0) });
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 10) });

    const { container } = render(
      <CadStoreProvider store={store}>
        <SketchOverlay />
      </CadStoreProvider>,
    );

    expect(container.querySelector('.sketch-overlay__circle.sketch-overlay__edge--construction')).not.toBeNull();
  });

  it('renders without an active sketch feature', () => {
    renderOverlay();
    expect(screen.getByRole('img', { name: 'Sketch canvas' })).toBeInTheDocument();
  });
});
