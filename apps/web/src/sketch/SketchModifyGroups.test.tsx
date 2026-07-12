import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore } from '../store/cad-store.js';
import { SketchModifyGroups } from './SketchModifyGroups.js';

function renderGroups(store = createCadStore()) {
  store.getState().enterSketch('XY');
  render(
    <CadStoreProvider store={store}>
      <SketchModifyGroups />
    </CadStoreProvider>,
  );
  return store;
}

describe('SketchModifyGroups', () => {
  it('renders an accessible Modify group with the Trim primary button and shortcut', () => {
    renderGroups();
    const group = screen.getAllByRole('group', { name: 'Modify' })[0]!;
    expect(group).toBeInTheDocument();
    const trim = screen.getByRole('button', { name: 'Trim' });
    expect(trim).toHaveAttribute('aria-keyshortcuts', 'T');
    expect(trim).toHaveAttribute('aria-pressed', 'false');
  });

  it('exposes Split behind the family dropdown and activates it through the store', () => {
    const store = renderGroups();
    expect(screen.queryByRole('menuitemradio', { name: 'Split' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Modify tools' }));
    const split = screen.getByRole('menuitemradio', { name: 'Split' });
    expect(split).toHaveAttribute('aria-keyshortcuts', 'K');
    fireEvent.click(split);
    expect(store.getState().sketch?.modify?.tool).toBe('split');
  });

  it('exposes Extend behind the family dropdown with its icon, shortcut and radio semantics', () => {
    const store = renderGroups();
    expect(screen.queryByRole('menuitemradio', { name: 'Extend' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Modify tools' }));
    const extend = screen.getByRole('menuitemradio', { name: 'Extend' });
    expect(extend).toHaveAttribute('aria-keyshortcuts', 'E');
    expect(extend).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(extend);
    expect(store.getState().sketch?.modify?.tool).toBe('extend');
    // Re-opening the menu shows Extend now checked as the active tool.
    fireEvent.click(screen.getByRole('button', { name: 'Modify tools' }));
    expect(screen.getByRole('menuitemradio', { name: 'Extend' })).toHaveAttribute('aria-checked', 'true');
  });

  it('exposes an accessible Fillet button with the F shortcut that toggles the tool', () => {
    const store = renderGroups();
    const fillet = screen.getByRole('button', { name: 'Fillet' });
    expect(fillet).toHaveAttribute('aria-keyshortcuts', 'F');
    expect(fillet).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(fillet);
    expect(store.getState().sketch?.fillet).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Fillet' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Fillet' }));
    expect(store.getState().sketch?.fillet).toBeNull();
  });

  it('activates Trim and reflects aria-pressed, toggling off when clicked again', () => {
    const store = renderGroups();
    const trim = screen.getByRole('button', { name: 'Trim' });
    fireEvent.click(trim);
    expect(store.getState().sketch?.modify?.tool).toBe('trim');
    expect(screen.getByRole('button', { name: 'Trim' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Trim' }));
    expect(store.getState().sketch?.modify).toBeNull();
  });
});
