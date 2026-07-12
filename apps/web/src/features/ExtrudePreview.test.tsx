import type { CadDocumentV2, SketchEntity } from '@swalha-cad/document';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore } from '../store/cad-store.js';
import { ExtrudePreview } from './ExtrudePreview.js';

function rectangleEntities(): SketchEntity[] {
  return [
    { id: 'p0', kind: 'point', x: 0, y: 0, construction: false },
    { id: 'p1', kind: 'point', x: 40, y: 0, construction: false },
    { id: 'p2', kind: 'point', x: 40, y: 20, construction: false },
    { id: 'p3', kind: 'point', x: 0, y: 20, construction: false },
    { id: 'l0', kind: 'line', startId: 'p0', endId: 'p1', construction: false },
    { id: 'l1', kind: 'line', startId: 'p1', endId: 'p2', construction: false },
    { id: 'l2', kind: 'line', startId: 'p2', endId: 'p3', construction: false },
    { id: 'l3', kind: 'line', startId: 'p3', endId: 'p0', construction: false },
  ];
}

function documentWith(entities: SketchEntity[]): CadDocumentV2 {
  return {
    schemaVersion: 2,
    units: 'mm',
    entities: [],
    features: [{ id: 'sk1', kind: 'sketch', name: 'Sketch 1', plane: 'XY', entities, constraints: [], visible: true }],
  };
}

type Store = ReturnType<typeof createCadStore>;

function renderPreview(open = true): Store {
  const store = createCadStore(documentWith(rectangleEntities()));
  if (open) store.getState().startExtrude();
  render(
    <CadStoreProvider store={store}>
      <ExtrudePreview />
    </CadStoreProvider>,
  );
  return store;
}

describe('ExtrudePreview manipulator', () => {
  it('renders nothing when no extrude task is active', () => {
    renderPreview(false);
    expect(screen.queryByRole('slider', { name: 'Extrude depth' })).not.toBeInTheDocument();
  });

  it('exposes the current depth as an accessible vertical slider', () => {
    const store = renderPreview();
    const slider = screen.getByRole('slider', { name: 'Extrude depth' });
    expect(slider).toHaveAttribute('aria-orientation', 'vertical');
    expect(slider).toHaveAttribute('aria-valuenow', String(store.getState().extrude!.depth));
  });

  it('increases and decreases depth with the arrow keys, staying synchronized with the store', () => {
    const store = renderPreview();
    const slider = screen.getByRole('slider', { name: 'Extrude depth' });
    const start = store.getState().extrude!.depth;

    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    expect(store.getState().extrude!.depth).toBeCloseTo(start + 1, 5);
    expect(slider).toHaveAttribute('aria-valuenow', String(store.getState().extrude!.depth));

    fireEvent.keyDown(slider, { key: 'ArrowDown' });
    fireEvent.keyDown(slider, { key: 'ArrowDown' });
    expect(store.getState().extrude!.depth).toBeCloseTo(start - 1, 5);
  });

  it('reflects a depth changed elsewhere (e.g. the numeric field)', () => {
    const store = renderPreview();
    const slider = screen.getByRole('slider', { name: 'Extrude depth' });
    act(() => {
      store.getState().setExtrudeDepth(77);
    });
    expect(slider).toHaveAttribute('aria-valuenow', '77');
  });
});
