import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore } from '../store/cad-store.js';
import { SnapSettings } from './SnapSettings.js';

function renderSnapSettings(store = createCadStore()) {
  render(
    <CadStoreProvider store={store}>
      <SnapSettings />
    </CadStoreProvider>,
  );
  return store;
}

describe('SnapSettings', () => {
  it('exposes an accessible trigger that opens the settings panel', () => {
    renderSnapSettings();
    const trigger = screen.getByRole('button', { name: 'Snap settings' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: 'Snap settings' })).toBeInTheDocument();
  });

  it('renders one independent checkbox per snap target with sensible defaults', () => {
    renderSnapSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Snap settings' }));

    for (const name of ['Endpoints', 'Midpoints', 'Centers', 'Intersections', 'Horizontal / Vertical', 'Origin']) {
      expect(screen.getByRole('checkbox', { name })).toBeChecked();
    }
    // Grid snapping defaults off so the default click stays a continuous coordinate.
    expect(screen.getByRole('checkbox', { name: 'Grid' })).not.toBeChecked();
  });

  it('toggles a single snap target independently in the store', () => {
    const store = renderSnapSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Snap settings' }));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Endpoints' }));

    expect(store.getState().snapSettings.endpoint).toBe(false);
    expect(store.getState().snapSettings.midpoint).toBe(true); // others untouched
  });

  it('enables grid snapping without affecting other toggles', () => {
    const store = renderSnapSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Snap settings' }));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Grid' }));

    expect(store.getState().snapSettings.grid).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Grid' })).toBeChecked();
  });
});
