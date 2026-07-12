import type { CadDocumentV2 } from '@swalha-cad/document';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore } from '../store/cad-store.js';
import { buildTestDocument } from '../test/fixtures.js';
import { FeatureTree } from './FeatureTree.js';

function documentWithFeatures(): CadDocumentV2 {
  return {
    schemaVersion: 2,
    units: 'mm',
    entities: buildTestDocument().entities,
    features: [
      { id: 'sk-1', kind: 'sketch', name: 'Sketch 1', plane: 'XY', entities: [], constraints: [], visible: true },
      { id: 'ex-1', kind: 'extrude', name: 'Extrude 1', sketchId: 'sk-1', depth: 10, direction: 'normal', visible: true },
    ],
  };
}

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

  it('lists the Default geometry group: Origin and the Top/Front/Right planes', () => {
    renderFeatureTree();

    expect(screen.getByText('Default geometry')).toBeInTheDocument();
    expect(screen.getByText('Origin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Top' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Front' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Right' })).toBeInTheDocument();
  });

  it('lists a Parts section with the body count and every entity by name', () => {
    renderFeatureTree();

    expect(screen.getByText('Parts (3)')).toBeInTheDocument();
    expect(screen.getByText('Box')).toBeInTheDocument();
    expect(screen.getByText('Cylinder')).toBeInTheDocument();
    expect(screen.getByText('L-Bracket')).toBeInTheDocument();
  });

  it('shows Parts (0) for a demo-free document', () => {
    renderFeatureTree(createCadStore());
    expect(screen.getByText('Parts (0)')).toBeInTheDocument();
  });

  it('preselects an origin plane when its row is clicked, mutually exclusive with body selection', () => {
    const store = renderFeatureTree();

    fireEvent.click(screen.getByRole('button', { name: 'Front' }));

    expect(store.getState().selectedPlane).toBe('XZ');
    expect(screen.getByRole('button', { name: 'Front' })).toHaveAttribute('aria-current', 'true');
  });

  it('shows an active draft Sketch row while the support command is open', () => {
    const store = createCadStore(buildTestDocument());
    store.getState().startSketch();
    renderFeatureTree(store);

    expect(screen.getByText('Sketch 1')).toBeInTheDocument();
    // Clicking a plane row during the command populates the collector rather than preselecting.
    fireEvent.click(screen.getByRole('button', { name: 'Top' }));
    expect(store.getState().sketchSupport?.support).toEqual({ kind: 'plane', plane: 'XY' });
  });

  it('double-clicking a plane during the command selects and confirms it', () => {
    const store = createCadStore(buildTestDocument());
    store.getState().startSketch();
    renderFeatureTree(store);

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Right' }));

    expect(store.getState().sketch?.plane).toBe('YZ');
    expect(store.getState().sketchSupport).toBeNull();
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

  it('renders Origin as a static row (not an interactive button)', () => {
    renderFeatureTree();

    expect(screen.queryByRole('button', { name: 'Origin' })).not.toBeInTheDocument();
    expect(screen.getByText('Origin')).toBeInTheDocument();
  });

  it('selects a feature in the store when its row is clicked', () => {
    const store = renderFeatureTree(createCadStore(documentWithFeatures()));

    fireEvent.click(screen.getByRole('button', { name: 'Extrude 1' }));

    expect(store.getState().selectedFeatureId).toBe('ex-1');
    expect(store.getState().selectedEntityId).toBeNull();
  });

  it('opens the extrude task when an extrude row is double-clicked', () => {
    const store = renderFeatureTree(createCadStore(documentWithFeatures()));

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Extrude 1' }));

    expect(store.getState().extrude).toMatchObject({ editingFeatureId: 'ex-1', depth: 10 });
  });

  it('offers an Edit action in the extrude row context menu', () => {
    const store = renderFeatureTree(createCadStore(documentWithFeatures()));

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Extrude 1' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit Extrude 1' }));

    expect(store.getState().extrude).toMatchObject({ editingFeatureId: 'ex-1' });
  });

  it('offers no Edit action for a sketch row', () => {
    renderFeatureTree(createCadStore(documentWithFeatures()));

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Sketch 1' }));

    expect(screen.queryByRole('menuitem', { name: 'Edit Sketch 1' })).not.toBeInTheDocument();
  });

  it('updates the shared hover state when the pointer enters and leaves a row', () => {
    const store = renderFeatureTree(createCadStore(documentWithFeatures()));
    const row = screen.getByRole('button', { name: 'Sketch 1' });

    fireEvent.mouseEnter(row);
    expect(store.getState().hoveredId).toBe('sk-1');

    fireEvent.mouseLeave(row);
    expect(store.getState().hoveredId).toBeNull();
  });

  it('right-clicking an unselected row selects it and opens a delete context menu', () => {
    const store = renderFeatureTree(createCadStore(documentWithFeatures()));

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Extrude 1' }));

    expect(store.getState().selectedFeatureId).toBe('ex-1');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete Extrude 1' })).toBeInTheDocument();
  });

  it('deletes an independent feature immediately via the context menu', () => {
    const store = renderFeatureTree(createCadStore(documentWithFeatures()));

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Extrude 1' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Extrude 1' }));

    expect(store.getState().document.features.some((feature) => feature.id === 'ex-1')).toBe(false);
    expect(store.getState().pendingDeletion).toBeNull();
  });

  it('opens the impact confirmation (not an immediate delete) for a sketch with a dependent', () => {
    const store = renderFeatureTree(createCadStore(documentWithFeatures()));

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Sketch 1' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Sketch 1' }));

    expect(store.getState().document.features).toHaveLength(2);
    expect(store.getState().pendingDeletion?.dependents).toEqual([{ id: 'ex-1', name: 'Extrude 1' }]);
  });

  it('deletes a body immediately via the context menu', () => {
    const store = renderFeatureTree(createCadStore(documentWithFeatures()));

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Cylinder' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Cylinder' }));

    expect(store.getState().document.entities.some((entity) => entity.id === 'cylinder-1')).toBe(false);
  });
});
