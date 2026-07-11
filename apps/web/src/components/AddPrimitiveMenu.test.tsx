import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore } from '../store/cad-store.js';
import { buildTestDocument } from '../test/fixtures.js';
import { AddPrimitiveMenu } from './AddPrimitiveMenu.js';

function renderMenu(store = createCadStore(buildTestDocument())) {
  render(
    <CadStoreProvider store={store}>
      <AddPrimitiveMenu />
    </CadStoreProvider>,
  );
  return store;
}

describe('AddPrimitiveMenu', () => {
  it('offers a button for each primitive kind', () => {
    renderMenu();

    expect(screen.getByRole('button', { name: /add box/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add cylinder/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add l-bracket/i })).toBeInTheDocument();
  });

  it('creates and selects a box', () => {
    const store = renderMenu();
    const before = store.getState().document.entities.length;

    fireEvent.click(screen.getByRole('button', { name: /add box/i }));

    const state = store.getState();
    expect(state.document.entities).toHaveLength(before + 1);
    const created = state.document.entities.at(-1);
    expect(created?.primitive.kind).toBe('box');
    expect(state.selectedEntityId).toBe(created?.id);
  });

  it('creates a cylinder', () => {
    const store = renderMenu();

    fireEvent.click(screen.getByRole('button', { name: /add cylinder/i }));

    expect(store.getState().document.entities.at(-1)?.primitive.kind).toBe('cylinder');
  });

  it('creates an l-bracket', () => {
    const store = renderMenu();

    fireEvent.click(screen.getByRole('button', { name: /add l-bracket/i }));

    expect(store.getState().document.entities.at(-1)?.primitive.kind).toBe('lBracket');
  });
});
