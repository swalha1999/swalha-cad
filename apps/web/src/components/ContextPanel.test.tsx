import type { CadDocumentV2 } from '@swalha-cad/document';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore } from '../store/cad-store.js';
import { buildTestDocument } from '../test/fixtures.js';
import { ContextPanel } from './ContextPanel.js';

function renderPanel(store = createCadStore(buildTestDocument())) {
  render(
    <CadStoreProvider store={store}>
      <ContextPanel />
    </CadStoreProvider>,
  );
  return store;
}

function documentWithExtrude(): CadDocumentV2 {
  return {
    schemaVersion: 2,
    units: 'mm',
    entities: [],
    features: [
      { id: 'sk-1', kind: 'sketch', name: 'Sketch 1', plane: 'XY', entities: [], constraints: [], visible: true },
      { id: 'ex-1', kind: 'extrude', name: 'Extrude 1', sketchId: 'sk-1', depth: 10, direction: 'normal', visible: true },
    ],
  };
}

describe('ContextPanel', () => {
  it('exposes the Properties complementary landmark', () => {
    renderPanel();

    expect(screen.getByRole('complementary', { name: 'Properties' })).toBeInTheDocument();
  });

  it('shows an empty-state message when nothing is selected', () => {
    renderPanel();

    expect(screen.getByText(/no selection/i)).toBeInTheDocument();
  });

  it('shows the selected entity name and primitive dimensions in millimetres', () => {
    const store = createCadStore(buildTestDocument());
    store.getState().selectEntity('box-1');
    renderPanel(store);

    expect(screen.getByDisplayValue('Box')).toBeInTheDocument();
    expect(screen.getByLabelText('Width')).toHaveValue(40);
    expect(screen.getByLabelText('Height')).toHaveValue(30);
    expect(screen.getByLabelText('Depth')).toHaveValue(20);
    expect(screen.getAllByText('mm').length).toBeGreaterThan(0);
  });

  it('renders the Extrude task panel while an extrude task is active', () => {
    const store = createCadStore(documentWithExtrude());
    store.getState().startExtrude();
    renderPanel(store);

    expect(screen.getByRole('heading', { name: 'Extrude' })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Extrude' })).toBeInTheDocument();
  });

  it('offers an Edit action for a selected extrude feature', () => {
    const store = createCadStore(documentWithExtrude());
    store.getState().selectFeature('ex-1');
    renderPanel(store);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Extrude 1' }));
    expect(store.getState().extrude).toMatchObject({ editingFeatureId: 'ex-1' });
  });

  it('shows cylinder-specific dimension fields', () => {
    const store = createCadStore(buildTestDocument());
    store.getState().selectEntity('cylinder-1');
    renderPanel(store);

    expect(screen.getByLabelText('Radius')).toHaveValue(15);
    expect(screen.getByLabelText('Height')).toHaveValue(40);
    expect(screen.queryByLabelText('Width')).not.toBeInTheDocument();
  });

  it('shows the transform translation with degree units for rotation', () => {
    const store = createCadStore(buildTestDocument());
    store.getState().selectEntity('bracket-1');
    renderPanel(store);

    expect(screen.getByLabelText('Translate X')).toHaveValue(60);
    expect(screen.getByLabelText('Translate Z')).toHaveValue(15);
    expect(screen.getByLabelText('Rotate Y')).toHaveValue(45);
    expect(screen.getAllByText('deg').length).toBeGreaterThan(0);
  });

  it('edits a dimension and regenerates the entity primitive', () => {
    const store = createCadStore(buildTestDocument());
    store.getState().selectEntity('box-1');
    renderPanel(store);

    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '99' } });
    fireEvent.blur(screen.getByLabelText('Width'));

    const updated = store.getState().document.entities.find((entity) => entity.id === 'box-1');
    expect(updated?.primitive).toEqual({ kind: 'box', width: 99, height: 30, depth: 20 });
  });

  it('rejects a non-positive dimension edit and shows an inline error', () => {
    const store = createCadStore(buildTestDocument());
    store.getState().selectEntity('box-1');
    renderPanel(store);

    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '0' } });
    fireEvent.blur(screen.getByLabelText('Width'));

    expect(screen.getByLabelText('Width')).toHaveValue(0);
    expect(screen.getByText(/invalid value/i)).toBeInTheDocument();
    const updated = store.getState().document.entities.find((entity) => entity.id === 'box-1');
    expect(updated?.primitive).toEqual({ kind: 'box', width: 40, height: 30, depth: 20 });
  });

  it('edits translate/rotate/scale transform fields', () => {
    const store = createCadStore(buildTestDocument());
    store.getState().selectEntity('box-1');
    renderPanel(store);

    fireEvent.change(screen.getByLabelText('Translate X'), { target: { value: '10' } });
    fireEvent.blur(screen.getByLabelText('Translate X'));
    fireEvent.change(screen.getByLabelText('Scale Y'), { target: { value: '2' } });
    fireEvent.blur(screen.getByLabelText('Scale Y'));

    const updated = store.getState().document.entities.find((entity) => entity.id === 'box-1');
    expect(updated?.transform).toEqual({ translation: [10, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 2, 1] });
  });

  it('offers no trash action when nothing is selected', () => {
    renderPanel();
    expect(screen.queryByRole('button', { name: /^Delete / })).not.toBeInTheDocument();
  });

  it('deletes the selected body through the contextual trash action', () => {
    const store = createCadStore(buildTestDocument());
    store.getState().selectEntity('box-1');
    renderPanel(store);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Box' }));

    expect(store.getState().document.entities.some((entity) => entity.id === 'box-1')).toBe(false);
  });

  it('shows a selected feature summary with a trash action', () => {
    const store = createCadStore({
      schemaVersion: 2,
      units: 'mm',
      entities: [],
      features: [{ id: 'sk-1', kind: 'sketch', name: 'Sketch 1', plane: 'XY', entities: [], constraints: [], visible: true }],
    });
    store.getState().selectFeature('sk-1');
    renderPanel(store);

    expect(screen.getByDisplayValue('Sketch 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Sketch 1' }));
    expect(store.getState().document.features).toHaveLength(0);
  });
});
