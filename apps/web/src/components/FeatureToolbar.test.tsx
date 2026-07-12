import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore } from '../store/cad-store.js';
import { buildTestDocument } from '../test/fixtures.js';
import { FeatureToolbar } from './FeatureToolbar.js';

function renderToolbar(store = createCadStore(buildTestDocument())) {
  render(
    <CadStoreProvider store={store}>
      <FeatureToolbar />
    </CadStoreProvider>,
  );
  return store;
}

describe('FeatureToolbar', () => {
  it('exposes the feature toolbar as a labeled toolbar', () => {
    renderToolbar();

    expect(screen.getByRole('toolbar', { name: 'Feature toolbar' })).toBeInTheDocument();
  });

  it('opens an origin-plane picker from the Sketch action', () => {
    renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: 'Sketch' }));

    expect(screen.getByRole('menuitem', { name: 'Top Plane (XY)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Front Plane (XZ)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Right Plane (YZ)' })).toBeInTheDocument();
  });

  it('enters a sketch on the chosen plane through the store', () => {
    const store = renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: 'Sketch' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Front Plane (XZ)' }));

    expect(store.getState().sketch?.plane).toBe('XZ');
    expect(store.getState().document.features).toHaveLength(1);
  });

  it('disables Extrude when the document has no sketch to extrude', () => {
    renderToolbar();

    expect(screen.getByRole('button', { name: 'Extrude' })).toBeDisabled();
  });

  it('enables Extrude once a sketch exists and opens the extrude task on click', () => {
    const store = createCadStore({
      schemaVersion: 2,
      units: 'mm',
      entities: [],
      features: [{ id: 'sk1', kind: 'sketch', name: 'Sketch 1', plane: 'XY', entities: [], constraints: [], visible: true }],
    });
    renderToolbar(store);

    const extrude = screen.getByRole('button', { name: 'Extrude' });
    expect(extrude).toBeEnabled();
    fireEvent.click(extrude);
    expect(store.getState().extrude).not.toBeNull();
  });

  it('offers buttons to add each primitive kind', () => {
    renderToolbar();

    expect(screen.getByRole('button', { name: /add box/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add cylinder/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add l-bracket/i })).toBeInTheDocument();
  });
});
