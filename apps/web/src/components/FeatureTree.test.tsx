import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore } from '../store/cad-store.js';
import { buildTestDocument } from '../test/fixtures.js';
import { FeatureTree } from './FeatureTree.js';

function renderFeatureTree(store = createCadStore(buildTestDocument())) {
  render(
    <CadStoreProvider store={store}>
      <FeatureTree />
    </CadStoreProvider>,
  );
  return store;
}

describe('FeatureTree', () => {
  it('exposes the scene tree navigation landmark', () => {
    renderFeatureTree();

    expect(screen.getByRole('navigation', { name: 'Scene tree' })).toBeInTheDocument();
  });

  it('lists the origin and the three standard planes above the bodies', () => {
    renderFeatureTree();

    expect(screen.getByText('Origin')).toBeInTheDocument();
    expect(screen.getByText('Front Plane (XZ)')).toBeInTheDocument();
    expect(screen.getByText('Top Plane (XY)')).toBeInTheDocument();
    expect(screen.getByText('Right Plane (YZ)')).toBeInTheDocument();
  });

  it('lists every entity in the document by name', () => {
    renderFeatureTree();

    expect(screen.getByText('Box')).toBeInTheDocument();
    expect(screen.getByText('Cylinder')).toBeInTheDocument();
    expect(screen.getByText('L-Bracket')).toBeInTheDocument();
  });

  it('marks no entity as selected initially', () => {
    renderFeatureTree();

    expect(screen.getByRole('button', { name: 'Box' })).toHaveAttribute('aria-current', 'false');
  });

  it('selects an entity in the store when its row is clicked', () => {
    const store = renderFeatureTree();

    fireEvent.click(screen.getByRole('button', { name: 'Cylinder' }));

    expect(store.getState().selectedEntityId).toBe('cylinder-1');
  });

  it('reflects the store selection with aria-current', () => {
    const store = createCadStore(buildTestDocument());
    store.getState().selectEntity('bracket-1');
    renderFeatureTree(store);

    expect(screen.getByRole('button', { name: 'L-Bracket' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Box' })).toHaveAttribute('aria-current', 'false');
  });

  it('does not render the origin/plane rows as interactive buttons', () => {
    renderFeatureTree();

    expect(screen.queryByRole('button', { name: 'Origin' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Front Plane (XZ)' })).not.toBeInTheDocument();
  });
});
