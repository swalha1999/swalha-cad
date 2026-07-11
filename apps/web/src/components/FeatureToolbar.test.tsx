import { render, screen } from '@testing-library/react';
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

  it('shows a disabled Sketch tool reserved for a later milestone', () => {
    renderToolbar();

    expect(screen.getByRole('button', { name: 'Sketch' })).toBeDisabled();
  });

  it('shows a disabled Extrude tool reserved for a later milestone', () => {
    renderToolbar();

    expect(screen.getByRole('button', { name: 'Extrude' })).toBeDisabled();
  });

  it('offers buttons to add each primitive kind', () => {
    renderToolbar();

    expect(screen.getByRole('button', { name: /add box/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add cylinder/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add l-bracket/i })).toBeInTheDocument();
  });
});
