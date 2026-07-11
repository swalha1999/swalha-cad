import { fireEvent, render, screen } from '@testing-library/react';
import { Plus } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { cn } from '../../lib/cn.js';
import { Button } from './Button.js';
import { DropdownMenu } from './DropdownMenu.js';
import { IconButton } from './IconButton.js';
import { Separator } from './Separator.js';
import { Tooltip } from './Tooltip.js';

describe('cn', () => {
  it('joins truthy class names with a space', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
  });

  it('flattens nested arrays', () => {
    expect(cn('a', ['b', false, ['c', undefined]], 'd')).toBe('a b c d');
  });

  it('returns an empty string when nothing is truthy', () => {
    expect(cn(false, undefined, null)).toBe('');
  });
});

describe('Button', () => {
  it('renders its children', () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('defaults to the default variant and type=button', () => {
    render(<Button>Save</Button>);

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button.className).toContain('btn--default');
  });

  it.each(['default', 'outline', 'secondary', 'ghost', 'destructive'] as const)(
    'applies the %s variant class',
    (variant) => {
      render(<Button variant={variant}>Action</Button>);

      expect(screen.getByRole('button', { name: 'Action' }).className).toContain(`btn--${variant}`);
    },
  );

  it('applies a compact icon size class', () => {
    render(<Button size="icon">X</Button>);

    expect(screen.getByRole('button', { name: 'X' }).className).toContain('btn--icon');
  });

  it('does not fire onClick and reports disabled state when disabled', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('merges a caller-provided className', () => {
    render(<Button className="extra">Save</Button>);

    expect(screen.getByRole('button', { name: 'Save' }).className).toContain('extra');
  });
});

describe('IconButton', () => {
  it('exposes the aria-label as its accessible name', () => {
    render(<IconButton icon={<Plus data-testid="icon" />} aria-label="Add box" />);

    expect(screen.getByRole('button', { name: 'Add box' })).toBeInTheDocument();
  });

  it('renders the provided icon', () => {
    render(<IconButton icon={<Plus data-testid="icon" />} aria-label="Add box" />);

    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('forwards onClick and disabled state', () => {
    const onClick = vi.fn();
    render(<IconButton icon={<Plus />} aria-label="Add box" disabled onClick={onClick} />);

    const button = screen.getByRole('button', { name: 'Add box' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Separator', () => {
  it('defaults to a horizontal separator', () => {
    render(<Separator />);

    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'horizontal');
  });

  it('supports a vertical orientation', () => {
    render(<Separator orientation="vertical" />);

    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical');
  });
});

describe('Tooltip', () => {
  it('associates the trigger with the tooltip content via aria-describedby on hover', () => {
    render(
      <Tooltip content="Add a new box primitive">
        <button type="button">Add box</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Add box' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(trigger).not.toHaveAttribute('aria-describedby');

    fireEvent.mouseEnter(trigger);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Add a new box primitive');
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id);

    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(trigger).not.toHaveAttribute('aria-describedby');
  });

  it('shows the tooltip on focus and hides it on blur', () => {
    render(
      <Tooltip content="Add a new box primitive">
        <button type="button">Add box</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Add box' });

    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.blur(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('closes on Escape while the trigger is focused', () => {
    render(
      <Tooltip content="Add a new box primitive">
        <button type="button">Add box</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Add box' });

    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

describe('DropdownMenu', () => {
  function renderMenu(overrides?: { disabledSecond?: boolean }) {
    const onSelectFirst = vi.fn();
    const onSelectSecond = vi.fn();
    render(
      <DropdownMenu
        label="Add primitive"
        items={[
          { id: 'box', label: 'Add Box', onSelect: onSelectFirst },
          {
            id: 'cylinder',
            label: 'Add Cylinder',
            onSelect: onSelectSecond,
            disabled: overrides?.disabledSecond,
          },
        ]}
      />,
    );
    return { onSelectFirst, onSelectSecond };
  }

  it('is closed by default with an accessible trigger', () => {
    renderMenu();

    const trigger = screen.getByRole('button', { name: 'Add primitive' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens the menu and focuses the first item when the trigger is clicked', () => {
    renderMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Add primitive' }));

    expect(screen.getByRole('button', { name: 'Add primitive' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: 'Add Box' })).toHaveFocus();
  });

  it('moves focus between items with ArrowDown/ArrowUp and wraps around', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Add primitive' }));

    const box = screen.getByRole('menuitem', { name: 'Add Box' });
    const cylinder = screen.getByRole('menuitem', { name: 'Add Cylinder' });

    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(cylinder).toHaveFocus();

    fireEvent.keyDown(cylinder, { key: 'ArrowDown' });
    expect(box).toHaveFocus();

    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(cylinder).toHaveFocus();
  });

  it('jumps to first/last item with Home/End', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Add primitive' }));

    const box = screen.getByRole('menuitem', { name: 'Add Box' });
    const cylinder = screen.getByRole('menuitem', { name: 'Add Cylinder' });

    fireEvent.keyDown(box, { key: 'End' });
    expect(cylinder).toHaveFocus();

    fireEvent.keyDown(cylinder, { key: 'Home' });
    expect(box).toHaveFocus();
  });

  it('selects an item with click, closes the menu, and returns focus to the trigger', () => {
    const { onSelectFirst } = renderMenu();
    const trigger = screen.getByRole('button', { name: 'Add primitive' });
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Box' }));

    expect(onSelectFirst).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes without selecting when Escape is pressed, and returns focus to the trigger', () => {
    const { onSelectFirst } = renderMenu();
    const trigger = screen.getByRole('button', { name: 'Add primitive' });
    fireEvent.click(trigger);

    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Add Box' }), { key: 'Escape' });

    expect(onSelectFirst).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes the menu when clicking outside without selecting', () => {
    const { onSelectFirst } = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Add primitive' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(onSelectFirst).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('disables an item and ignores clicks on it', () => {
    const { onSelectSecond } = renderMenu({ disabledSecond: true });
    fireEvent.click(screen.getByRole('button', { name: 'Add primitive' }));

    const cylinder = screen.getByRole('menuitem', { name: 'Add Cylinder' });
    expect(cylinder).toBeDisabled();

    fireEvent.click(cylinder);
    expect(onSelectSecond).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});
