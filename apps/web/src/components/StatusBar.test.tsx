import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore } from '../store/cad-store.js';
import { buildTestDocument } from '../test/fixtures.js';
import { StatusBar } from './StatusBar.js';

function renderStatusBar(store = createCadStore(buildTestDocument())) {
  render(
    <CadStoreProvider store={store}>
      <StatusBar />
    </CadStoreProvider>,
  );
  return store;
}

describe('StatusBar', () => {
  it('exposes a Part Studio tab', () => {
    renderStatusBar();

    expect(screen.getByRole('tab', { name: 'Part Studio 1' })).toBeInTheDocument();
  });

  it('shows the document units', () => {
    renderStatusBar();

    expect(screen.getByText('mm')).toBeInTheDocument();
  });

  it('shows the body count', () => {
    renderStatusBar();

    expect(screen.getByText('3 bodies')).toBeInTheDocument();
  });

  it('shows "No selection" when nothing is selected', () => {
    renderStatusBar();

    expect(screen.getByText('No selection')).toBeInTheDocument();
  });

  it('shows the selected entity name', () => {
    const store = renderStatusBar();

    act(() => {
      store.getState().selectEntity('cylinder-1');
    });

    expect(screen.getByText('Cylinder')).toBeInTheDocument();
  });

  it('shows the active camera projection', () => {
    const store = renderStatusBar();

    expect(screen.getByText('Perspective')).toBeInTheDocument();

    act(() => {
      store.getState().setCameraProjection('orthographic');
    });

    expect(screen.getByText('Orthographic')).toBeInTheDocument();
  });
});
