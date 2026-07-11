import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResizablePanel } from './ResizablePanel.js';

function renderPanel(overrides: Partial<ComponentProps<typeof ResizablePanel>> = {}) {
  return render(
    <ResizablePanel side="left" label="Feature Tree" defaultWidth={260} minWidth={180} maxWidth={420} {...overrides}>
      <p>panel body</p>
    </ResizablePanel>,
  );
}

describe('ResizablePanel', () => {
  it('renders its children at the default width', () => {
    const { container } = renderPanel();

    expect(screen.getByText('panel body')).toBeInTheDocument();
    const panel = container.querySelector('.resizable-panel')!;
    expect((panel as HTMLElement).style.width).toBe('260px');
  });

  it('exposes a keyboard-accessible vertical separator with the current width', () => {
    renderPanel();

    const separator = screen.getByRole('separator', { name: 'Resize Feature Tree' });
    expect(separator).toHaveAttribute('aria-orientation', 'vertical');
    expect(separator).toHaveAttribute('aria-valuenow', '260');
    expect(separator).toHaveAttribute('aria-valuemin', '180');
    expect(separator).toHaveAttribute('aria-valuemax', '420');
    expect(separator).toHaveAttribute('tabIndex', '0');
  });

  it('collapses and hides the body when the toggle button is clicked', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Feature Tree' }));

    expect(screen.queryByText('panel body')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand Feature Tree' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands again when the toggle button is clicked a second time', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Feature Tree' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand Feature Tree' }));

    expect(screen.getByText('panel body')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse Feature Tree' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('hides the resizer while collapsed', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Feature Tree' }));

    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('grows the left panel by dragging the resizer to the right', () => {
    const { container } = renderPanel();
    const separator = screen.getByRole('separator', { name: 'Resize Feature Tree' });

    fireEvent.mouseDown(separator, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 140 });
    fireEvent.mouseUp(window);

    const panel = container.querySelector('.resizable-panel')!;
    expect((panel as HTMLElement).style.width).toBe('300px');
  });

  it('shrinks the right panel by dragging the resizer to the right', () => {
    const { container } = renderPanel({ side: 'right', label: 'Properties' });
    const separator = screen.getByRole('separator', { name: 'Resize Properties' });

    fireEvent.mouseDown(separator, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 140 });
    fireEvent.mouseUp(window);

    const panel = container.querySelector('.resizable-panel')!;
    expect((panel as HTMLElement).style.width).toBe('220px');
  });

  it('clamps width to the configured minimum and maximum', () => {
    const { container } = renderPanel();
    const separator = screen.getByRole('separator', { name: 'Resize Feature Tree' });
    const panel = container.querySelector('.resizable-panel')! as HTMLElement;

    fireEvent.mouseDown(separator, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: -1000 });
    fireEvent.mouseUp(window);
    expect(panel.style.width).toBe('180px');

    fireEvent.mouseDown(separator, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 5000 });
    fireEvent.mouseUp(window);
    expect(panel.style.width).toBe('420px');
  });

  it('resizes with ArrowLeft/ArrowRight on the separator', () => {
    const { container } = renderPanel();
    const separator = screen.getByRole('separator', { name: 'Resize Feature Tree' });
    const panel = container.querySelector('.resizable-panel')! as HTMLElement;

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(panel.style.width).toBe('272px');

    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(panel.style.width).toBe('248px');
  });

  it('jumps to the minimum/maximum width with Home/End on the separator', () => {
    const { container } = renderPanel();
    const separator = screen.getByRole('separator', { name: 'Resize Feature Tree' });
    const panel = container.querySelector('.resizable-panel')! as HTMLElement;

    fireEvent.keyDown(separator, { key: 'Home' });
    expect(panel.style.width).toBe('180px');

    fireEvent.keyDown(separator, { key: 'End' });
    expect(panel.style.width).toBe('420px');
  });
});
