import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ViewportControls } from './ViewportControls.js';

describe('ViewportControls', () => {
  it('exposes a labeled navigation group', () => {
    render(<ViewportControls projection="perspective" onProjectionChange={vi.fn()} onHome={vi.fn()} />);

    expect(screen.getByRole('group', { name: 'Viewport navigation' })).toBeInTheDocument();
  });

  it('marks perspective as pressed by default', () => {
    render(<ViewportControls projection="perspective" onProjectionChange={vi.fn()} onHome={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Perspective' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Orthographic' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches projection when Orthographic is clicked', () => {
    const onProjectionChange = vi.fn();
    render(<ViewportControls projection="perspective" onProjectionChange={onProjectionChange} onHome={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Orthographic' }));

    expect(onProjectionChange).toHaveBeenCalledWith('orthographic');
  });

  it('reflects an orthographic projection prop', () => {
    render(<ViewportControls projection="orthographic" onProjectionChange={vi.fn()} onHome={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Orthographic' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Perspective' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onHome when the home button is clicked', () => {
    const onHome = vi.fn();
    render(<ViewportControls projection="perspective" onProjectionChange={vi.fn()} onHome={onHome} />);

    fireEvent.click(screen.getByRole('button', { name: 'Home view' }));

    expect(onHome).toHaveBeenCalled();
  });
});
