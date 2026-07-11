import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Transform } from '@swalha-cad/document';
import { TransformFields } from './TransformFields.js';

const IDENTITY: Transform = { translation: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] };

describe('TransformFields', () => {
  it('renders translate, rotate, and scale fields with units', () => {
    render(<TransformFields transform={IDENTITY} onCommit={vi.fn()} />);

    expect(screen.getByLabelText('Translate X')).toHaveValue(0);
    expect(screen.getByLabelText('Translate Y')).toHaveValue(0);
    expect(screen.getByLabelText('Translate Z')).toHaveValue(0);
    expect(screen.getByLabelText('Rotate X')).toHaveValue(0);
    expect(screen.getByLabelText('Rotate Y')).toHaveValue(0);
    expect(screen.getByLabelText('Rotate Z')).toHaveValue(0);
    expect(screen.getByLabelText('Scale X')).toHaveValue(1);
    expect(screen.getByLabelText('Scale Y')).toHaveValue(1);
    expect(screen.getByLabelText('Scale Z')).toHaveValue(1);
    expect(screen.getAllByText('mm').length).toBe(3);
    expect(screen.getAllByText('deg').length).toBe(3);
  });

  it('shows the current transform values', () => {
    const transform: Transform = { translation: [60, 0, 15], rotationDeg: [0, 45, 0], scale: [1, 1, 1] };
    render(<TransformFields transform={transform} onCommit={vi.fn()} />);

    expect(screen.getByLabelText('Translate X')).toHaveValue(60);
    expect(screen.getByLabelText('Translate Z')).toHaveValue(15);
    expect(screen.getByLabelText('Rotate Y')).toHaveValue(45);
  });

  it('commits an edited translation axis, merging with the rest of the transform', () => {
    const onCommit = vi.fn(() => true);
    render(<TransformFields transform={IDENTITY} onCommit={onCommit} />);

    fireEvent.change(screen.getByLabelText('Translate Y'), { target: { value: '25' } });
    fireEvent.blur(screen.getByLabelText('Translate Y'));

    expect(onCommit).toHaveBeenCalledWith({ translation: [0, 25, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] });
  });

  it('commits an edited rotation axis', () => {
    const onCommit = vi.fn(() => true);
    render(<TransformFields transform={IDENTITY} onCommit={onCommit} />);

    fireEvent.change(screen.getByLabelText('Rotate Z'), { target: { value: '90' } });
    fireEvent.blur(screen.getByLabelText('Rotate Z'));

    expect(onCommit).toHaveBeenCalledWith({ translation: [0, 0, 0], rotationDeg: [0, 0, 90], scale: [1, 1, 1] });
  });

  it('commits an edited scale axis', () => {
    const onCommit = vi.fn(() => true);
    render(<TransformFields transform={IDENTITY} onCommit={onCommit} />);

    fireEvent.change(screen.getByLabelText('Scale X'), { target: { value: '2.5' } });
    fireEvent.blur(screen.getByLabelText('Scale X'));

    expect(onCommit).toHaveBeenCalledWith({ translation: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [2.5, 1, 1] });
  });
});
