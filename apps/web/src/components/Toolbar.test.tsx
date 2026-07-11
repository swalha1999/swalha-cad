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

  it('offers buttons to add each primitive kind', () => {
    renderToolbar();

    expect(screen.getByRole('button', { name: /add box/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add cylinder/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add l-bracket/i })).toBeInTheDocument();
  });

  it('disables undo and redo when there is no history', () => {
    renderToolbar();

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });

  it('undoes and redoes a create through the toolbar buttons', () => {
    const store = renderToolbar();
    const before = store.getState().document.entities.length;

    fireEvent.click(screen.getByRole('button', { name: /add box/i }));
    expect(store.getState().document.entities).toHaveLength(before + 1);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(store.getState().document.entities).toHaveLength(before);
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(store.getState().document.entities).toHaveLength(before + 1);
  });
});
