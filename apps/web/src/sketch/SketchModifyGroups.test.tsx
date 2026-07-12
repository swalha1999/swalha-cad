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
