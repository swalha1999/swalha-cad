import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Square } from 'lucide-react';
import { CadStoreProvider } from '../store/cad-store-context.js';
import { createCadStore } from '../store/cad-store.js';
import { SketchToolGroups, ToolbarGroup } from './SketchToolGroups.js';

function renderGroups(store = createCadStore()) {
  store.getState().enterSketch('XY');
  render(
    <CadStoreProvider store={store}>
      <SketchToolGroups />
    </CadStoreProvider>,
  );
  return store;
}

describe('SketchToolGroups', () => {
  it('renders a dense, accessible Create group with every existing tool', () => {
    renderGroups();
    const group = screen.getByRole('group', { name: 'Create' });
    expect(group).toBeInTheDocument();
    for (const name of ['Point', 'Line', 'Rectangle', 'Circle', 'Construction']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('advertises each tool keyboard shortcut via aria-keyshortcuts', () => {
    renderGroups();
    expect(screen.getByRole('button', { name: 'Rectangle' })).toHaveAttribute('aria-keyshortcuts', 'R');
    expect(screen.getByRole('button', { name: 'Line' })).toHaveAttribute('aria-keyshortcuts', 'L');
  });

  it('activates a tool through the store and reflects aria-pressed', () => {
    const store = renderGroups();
    fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
    expect(store.getState().sketch?.tool).toBe('circle');
    expect(screen.getByRole('button', { name: 'Circle' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles construction geometry through the store', () => {
    const store = renderGroups();
    fireEvent.click(screen.getByRole('button', { name: 'Construction' }));
    expect(store.getState().sketch?.construction).toBe(true);
  });
});

describe('ToolbarGroup overflow infrastructure', () => {
  it('renders primary items directly and hides overflow behind a menu', () => {
    const primary = vi.fn();
    const extra = vi.fn();
    render(
      <ToolbarGroup
        label="Modify"
        items={[{ id: 'a', label: 'Primary', icon: <Square />, onSelect: primary }]}
        overflow={[{ id: 'b', label: 'Extra', icon: <Square />, onSelect: extra }]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Primary' })).toBeInTheDocument();
    // Overflow item is not rendered until the More menu is opened.
    expect(screen.queryByRole('menuitem', { name: 'Extra' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'More Modify tools' }));
    const item = screen.getByRole('menuitem', { name: 'Extra' });
    expect(item).toBeInTheDocument();

    fireEvent.click(item);
    expect(extra).toHaveBeenCalledOnce();
  });

  it('omits the overflow trigger when there is nothing to overflow', () => {
    render(<ToolbarGroup label="Create" items={[{ id: 'a', label: 'Primary', icon: <Square />, onSelect: () => {} }]} />);
    expect(screen.queryByRole('button', { name: 'More Create tools' })).toBeNull();
  });
});
