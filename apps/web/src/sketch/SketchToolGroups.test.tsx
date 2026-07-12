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
  it('renders a dense, accessible Create group with every tool family', () => {
    renderGroups();
    const group = screen.getByRole('group', { name: 'Create' });
    expect(group).toBeInTheDocument();
    for (const name of ['Point', 'Line', 'Rectangle', 'Circle', 'Arc', 'Slot', 'Polygon', 'Construction']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('advertises each family keyboard shortcut via aria-keyshortcuts', () => {
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

  describe('rectangle split button', () => {
    it('exposes the corner/center/3-point variants behind the family dropdown', () => {
      renderGroups();
      expect(screen.queryByRole('menuitemradio', { name: 'Center rectangle' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Rectangle variants' }));
      expect(screen.getByRole('menuitemradio', { name: 'Corner rectangle' })).toBeInTheDocument();
      expect(screen.getByRole('menuitemradio', { name: 'Center rectangle' })).toBeInTheDocument();
      expect(screen.getByRole('menuitemradio', { name: '3-point rectangle' })).toBeInTheDocument();
    });

    it('activates a chosen variant and marks it active in the menu', () => {
      const store = renderGroups();
      fireEvent.click(screen.getByRole('button', { name: 'Rectangle variants' }));
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Center rectangle' }));
      expect(store.getState().sketch?.tool).toBe('rectangle-center');
    });

    it('repeats the last-used variant when the primary button is clicked again', () => {
      const store = renderGroups();
      // Pick the 3-point variant from the menu.
      fireEvent.click(screen.getByRole('button', { name: 'Rectangle variants' }));
      fireEvent.click(screen.getByRole('menuitemradio', { name: '3-point rectangle' }));
      expect(store.getState().sketch?.tool).toBe('rectangle-3point');
      // Clicking the primary while active toggles it off...
      fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
      expect(store.getState().sketch?.tool).toBeNull();
      // ...and clicking it again repeats the last-used (3-point) variant, not the corner default.
      fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
      expect(store.getState().sketch?.tool).toBe('rectangle-3point');
    });
  });

  describe('circle split button', () => {
    it('exposes the center and 3-point circle variants', () => {
      const store = renderGroups();
      fireEvent.click(screen.getByRole('button', { name: 'Circle variants' }));
      expect(screen.getByRole('menuitemradio', { name: 'Center circle' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('menuitemradio', { name: '3-point circle' }));
      expect(store.getState().sketch?.tool).toBe('circle-3point');
    });
  });

  describe('arc split button', () => {
    it('exposes the 3-point / center / tangent arc variants with the family shortcut', () => {
      renderGroups();
      expect(screen.getByRole('button', { name: 'Arc' })).toHaveAttribute('aria-keyshortcuts', 'A');
      fireEvent.click(screen.getByRole('button', { name: 'Arc variants' }));
      expect(screen.getByRole('menuitemradio', { name: '3-point arc' })).toBeInTheDocument();
      expect(screen.getByRole('menuitemradio', { name: 'Center point arc' })).toBeInTheDocument();
      expect(screen.getByRole('menuitemradio', { name: 'Tangent arc' })).toBeInTheDocument();
    });

    it('activates a chosen arc variant through the store', () => {
      const store = renderGroups();
      fireEvent.click(screen.getByRole('button', { name: 'Arc variants' }));
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Tangent arc' }));
      expect(store.getState().sketch?.tool).toBe('arc-tangent');
    });

    it('primary button activates the last-used arc variant (defaulting to 3-point)', () => {
      const store = renderGroups();
      fireEvent.click(screen.getByRole('button', { name: 'Arc' }));
      expect(store.getState().sketch?.tool).toBe('arc-3point');
    });
  });

  describe('slot', () => {
    it('activates the slot tool with its S shortcut advertised', () => {
      const store = renderGroups();
      const slot = screen.getByRole('button', { name: 'Slot' });
      expect(slot).toHaveAttribute('aria-keyshortcuts', 'S');
      fireEvent.click(slot);
      expect(store.getState().sketch?.tool).toBe('slot');
    });
  });

  describe('polygon', () => {
    it('activates the polygon tool and edits the side count', () => {
      const store = renderGroups();
      fireEvent.click(screen.getByRole('button', { name: 'Polygon' }));
      expect(store.getState().sketch?.tool).toBe('polygon');
      const sides = screen.getByRole('spinbutton', { name: 'Polygon sides' });
      fireEvent.change(sides, { target: { value: '5' } });
      expect(store.getState().sketch?.polygonSides).toBe(5);
      expect(store.getState().sketch?.toolState).toMatchObject({ tool: 'polygon', sides: 5 });
    });
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
