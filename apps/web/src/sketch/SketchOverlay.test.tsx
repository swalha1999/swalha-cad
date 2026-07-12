import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SnapResult } from './tools/types.js';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore, selectActiveSketch } from '../store/cad-store.js';
import { SketchOverlay } from './SketchOverlay.js';

function freeSnap(x: number, y: number): SnapResult {
  return { point: { x, y }, ref: { kind: 'new', x, y }, kind: 'grid' };
}

/** A store in XY sketch mode with a single free line, tool cleared. */
function lineStore() {
  let n = 0;
  const store = createCadStore(undefined, { createId: () => `id-${++n}` });
  store.getState().enterSketch('XY');
  store.getState().setSketchTool('line');
  store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(3, 7) });
  store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(33, 47) });
  store.getState().dispatchSketchEvent({ type: 'finish' });
  store.getState().setSketchTool(null);
  return store;
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

  it('previews the Trim removal piece and highlights the target when a modify tool is active', () => {
    let n = 0;
    const store = createCadStore(undefined, { createId: () => `id-${++n}` });
    store.getState().enterSketch('XY');
    // A target line crossed by a vertical boundary line.
    store.getState().setSketchTool('line');
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 0) });
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(120, 0) });
    store.getState().dispatchSketchEvent({ type: 'finish' });
    store.getState().setSketchTool('line');
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(100, -10) });
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(100, 10) });
    store.getState().dispatchSketchEvent({ type: 'finish' });
    store.getState().setSketchModifyTool('trim');
    store.getState().setModifyPoint({ x: 110, y: 0 });

    const { container } = render(
      <CadStoreProvider store={store}>
        <SketchOverlay />
      </CadStoreProvider>,
    );

    expect(container.querySelector('.sketch-overlay__modify-target')).not.toBeNull();
    expect(container.querySelector('.sketch-overlay__modify-remove')).not.toBeNull();
    // No per-entity hit targets while a modify tool owns clicks.
    expect(container.querySelector('.sketch-overlay__hit')).toBeNull();
  });

  it('shows a cursor-local diagnostic when a Trim hover has no valid intersection', () => {
    const store = lineStore();
    store.getState().setSketchModifyTool('trim');
    store.getState().setModifyPoint({ x: 18, y: 27 }); // on the lone line, but nothing to trim against

    const { container } = render(
      <CadStoreProvider store={store}>
        <SketchOverlay />
      </CadStoreProvider>,
    );

    const error = container.querySelector('.sketch-overlay__modify-error');
    expect(error).not.toBeNull();
    expect(error?.textContent).toMatch(/no intersections/i);
  });

  it('marks the Split point under the cursor', () => {
    const store = lineStore();
    store.getState().setSketchModifyTool('split');
    store.getState().setModifyPoint({ x: 18, y: 27 });

    const { container } = render(
      <CadStoreProvider store={store}>
        <SketchOverlay />
      </CadStoreProvider>,
    );

    expect(container.querySelector('.sketch-overlay__modify-split')).not.toBeNull();
  });

  it('draws a committed arc and exposes it as a selectable hit target', () => {
    const store = createCadStore();
    store.getState().enterSketch('XY');
    store.getState().setSketchTool('arc-3point');
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(10, 0) });
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(-10, 0) });
    store.getState().dispatchSketchEvent({ type: 'click', snap: freeSnap(0, 10) });
    store.getState().setSketchTool(null);

    const { container } = render(
      <CadStoreProvider store={store}>
        <SketchOverlay />
      </CadStoreProvider>,
    );

    expect(container.querySelectorAll('.sketch-overlay__arc:not(.sketch-overlay__hit)')).toHaveLength(1);
    expect(container.querySelector('[data-entity-kind="arc"] .sketch-overlay__hit--arc')).not.toBeNull();
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

  it('shows the live dimension annotation and inline editor while awaiting a value', () => {
    const store = lineStore();
    const line = selectActiveSketch(store.getState())!.entities.find((e) => e.kind === 'line')!;
    store.getState().setSketchSelection([line.id]);
    store.getState().startDimension();

    const { container } = render(
      <CadStoreProvider store={store}>
        <SketchOverlay />
      </CadStoreProvider>,
    );

    expect(screen.getByTestId('dimension-annotation')).toBeInTheDocument();
    expect(container.querySelectorAll('.sketch-overlay__dimension-witness')).toHaveLength(2);
    const input = screen.getByLabelText('Dimension value');
    expect(input).toHaveValue('50');
  });

  it('routes an entity click to the dimension pick while the tool is picking geometry', () => {
    const store = lineStore();
    store.getState().startDimension(); // no selection -> picking phase
    expect(store.getState().sketch!.dimension).toEqual({ phase: 'picking', points: [] });

    const { container } = render(
      <CadStoreProvider store={store}>
        <SketchOverlay />
      </CadStoreProvider>,
    );

    const hit = container.querySelector('line.sketch-overlay__hit');
    expect(hit).not.toBeNull();
    fireEvent.click(hit!);

    // Clicking the line resolves the dimension straight to awaiting a value.
    expect(store.getState().sketch!.dimension?.phase).toBe('awaiting');
  });
});
