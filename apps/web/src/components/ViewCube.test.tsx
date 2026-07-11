import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ViewCube } from './ViewCube.js';

describe('ViewCube', () => {
  it('exposes a labeled view orientation group', () => {
    render(<ViewCube onSelectView={vi.fn()} />);

    expect(screen.getByRole('group', { name: 'View orientation' })).toBeInTheDocument();
  });

  it('offers Front, Top, Right, and Isometric view buttons', () => {
    render(<ViewCube onSelectView={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Front view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Top view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Right view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Isometric view' })).toBeInTheDocument();
  });

  it('calls onSelectView with the chosen standard view', () => {
    const onSelectView = vi.fn();
    render(<ViewCube onSelectView={onSelectView} />);

    fireEvent.click(screen.getByRole('button', { name: 'Top view' }));

    expect(onSelectView).toHaveBeenCalledWith('top');
  });

  it('renders a decorative X/Y/Z axis triad hidden from assistive tech', () => {
    render(<ViewCube onSelectView={vi.fn()} />);

    const triad = document.querySelector('.view-cube__axis-triad');
    expect(triad).not.toBeNull();
    expect(triad).toHaveAttribute('aria-hidden', 'true');
  });
});
