import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenu } from './ContextMenu.js';

describe('ContextMenu', () => {
  it('renders an accessible menu with the given items and focuses the first', () => {
    render(
      <ContextMenu
        label="Box"
        x={10}
        y={20}
        items={[{ id: 'delete', label: 'Delete Box', onSelect: vi.fn() }]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('menu', { name: 'Box' })).toBeInTheDocument();
    const item = screen.getByRole('menuitem', { name: 'Delete Box' });
    expect(item).toHaveFocus();
  });

  it('invokes the item and then closes when chosen', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu label="Box" x={0} y={0} items={[{ id: 'delete', label: 'Delete Box', onSelect }]} onClose={onClose} />);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Box' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<ContextMenu label="Box" x={0} y={0} items={[{ id: 'delete', label: 'Delete Box', onSelect: vi.fn() }]} onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Delete Box' }), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when a pointer-down occurs outside the menu', () => {
    const onClose = vi.fn();
    render(<ContextMenu label="Box" x={0} y={0} items={[{ id: 'delete', label: 'Delete Box', onSelect: vi.fn() }]} onClose={onClose} />);

    fireEvent.mouseDown(document.body);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
