import type { CadDocumentV2, SketchEntity } from '@swalha-cad/document';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore } from '../store/cad-store.js';
import { ExtrudeDialog } from './ExtrudeDialog.js';

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

function renderDialog(entities = rectangleEntities()): Store {
  let n = 0;
  const store = createCadStore(documentWith(entities), { createId: () => `gen-${++n}` });
  store.getState().startExtrude();
  render(
    <CadStoreProvider store={store}>
      <ExtrudeDialog />
    </CadStoreProvider>,
  );
  return store;
}

describe('ExtrudeDialog', () => {
  it('offers the document sketches as the source collector', () => {
    renderDialog();
    const select = screen.getByLabelText('Source sketch') as HTMLSelectElement;
    expect(select.value).toBe('sk1');
    expect(screen.getByRole('option', { name: 'Sketch 1' })).toBeInTheDocument();
  });

  it('switches the operation direction and disables reverse while symmetric', () => {
    const store = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Symmetric' }));
    expect(store.getState().extrude!.direction).toBe('symmetric');
    expect(screen.getByRole('button', { name: 'Reverse direction' })).toBeDisabled();
  });

  it('toggles reverse for a normal extrusion', () => {
    const store = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Reverse direction' }));
    expect(store.getState().extrude!.reverse).toBe(true);
  });

  it('updates the depth live as it is typed', () => {
    const store = renderDialog();
    const input = screen.getByLabelText('Depth');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '42' } });
    expect(store.getState().extrude!.depth).toBe(42);
  });

  it('enables Confirm for a valid profile and commits exactly one feature', () => {
    const store = renderDialog();
    const confirm = screen.getByRole('button', { name: 'Confirm extrude' });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(store.getState().extrude).toBeNull();
    expect(store.getState().document.features.filter((f) => f.kind === 'extrude')).toHaveLength(1);
  });

  it('disables Confirm and shows a diagnostic for an invalid profile', () => {
    const openChain: SketchEntity[] = [
      { id: 'p0', kind: 'point', x: 0, y: 0, construction: false },
      { id: 'p1', kind: 'point', x: 10, y: 0, construction: false },
      { id: 'l0', kind: 'line', startId: 'p0', endId: 'p1', construction: false },
    ];
    renderDialog(openChain);
    expect(screen.getByRole('button', { name: 'Confirm extrude' })).toBeDisabled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('cancels without committing anything', () => {
    const store = renderDialog();
    const before = store.getState().document;
    fireEvent.click(screen.getByRole('button', { name: 'Cancel extrude' }));
    expect(store.getState().extrude).toBeNull();
    expect(store.getState().document).toBe(before);
  });
});
