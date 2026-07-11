import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore } from '../store/cad-store.js';
import { buildTestDocument } from '../test/fixtures.js';
import { Toolbar } from './Toolbar.js';

function renderToolbar(store = createCadStore(buildTestDocument())) {
  render(
    <CadStoreProvider store={store}>
      <Toolbar />
    </CadStoreProvider>,
  );
  return store;
}

describe('Toolbar', () => {
  it('shows the SWALHA CAD title', () => {
    renderToolbar();

    expect(screen.getByText('SWALHA CAD')).toBeInTheDocument();
  });

  it('marks perspective as the active projection by default', () => {
    renderToolbar();

    expect(screen.getByRole('button', { name: 'Perspective' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Orthographic' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches the store camera projection to orthographic', () => {
    const store = renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: 'Orthographic' }));

    expect(store.getState().cameraProjection).toBe('orthographic');
  });

  it('switches back to perspective', () => {
    const store = createCadStore(buildTestDocument());
    store.getState().setCameraProjection('orthographic');
    renderToolbar(store);

    fireEvent.click(screen.getByRole('button', { name: 'Perspective' }));

    expect(store.getState().cameraProjection).toBe('perspective');
  });
});
