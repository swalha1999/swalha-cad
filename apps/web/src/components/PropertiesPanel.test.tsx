import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore } from '../store/cad-store.js';
import { buildTestDocument } from '../test/fixtures.js';
import { PropertiesPanel } from './PropertiesPanel.js';

function renderPanel(store = createCadStore(buildTestDocument())) {
  render(
    <CadStoreProvider store={store}>
      <PropertiesPanel />
    </CadStoreProvider>,
  );
  return store;
}

describe('PropertiesPanel', () => {
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
});
