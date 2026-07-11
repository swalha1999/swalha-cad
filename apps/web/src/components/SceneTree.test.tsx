import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore } from '../store/cad-store.js';
import { buildTestDocument } from '../test/fixtures.js';
import { SceneTree } from './SceneTree.js';

function renderSceneTree(store = createCadStore(buildTestDocument())) {
  render(
    <CadStoreProvider store={store}>
      <SceneTree />
    </CadStoreProvider>,
  );
  return store;
}

describe('SceneTree', () => {
  it('lists every entity in the document by name', () => {
    renderSceneTree();

    expect(screen.getByText('Box')).toBeInTheDocument();
    expect(screen.getByText('Cylinder')).toBeInTheDocument();
    expect(screen.getByText('L-Bracket')).toBeInTheDocument();
  });

  it('marks no entity as selected initially', () => {
    renderSceneTree();

    expect(screen.getByRole('button', { name: 'Box' })).toHaveAttribute('aria-current', 'false');
  });

  it('selects an entity in the store when its row is clicked', () => {
    const store = renderSceneTree();

    fireEvent.click(screen.getByRole('button', { name: 'Cylinder' }));

    expect(store.getState().selectedEntityId).toBe('cylinder-1');
  });

  it('reflects the store selection with aria-current', () => {
    const store = createCadStore(buildTestDocument());
    store.getState().selectEntity('bracket-1');
    renderSceneTree(store);

    expect(screen.getByRole('button', { name: 'L-Bracket' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Box' })).toHaveAttribute('aria-current', 'false');
  });
});
