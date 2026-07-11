import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NumericField } from './NumericField.js';

describe('NumericField', () => {
  it('renders the label, value, and unit', () => {
    render(<NumericField label="Width" value={40} unit="mm" />);

    expect(screen.getByLabelText('Width')).toHaveValue(40);
    expect(screen.getByText('mm')).toBeInTheDocument();
  });

  it('renders without a unit suffix when none is given', () => {
    render(<NumericField label="Segments" value={32} />);

    expect(screen.getByLabelText('Segments')).toHaveValue(32);
  });

  it('marks the input read-only when readOnly is set, and never calls onCommit', () => {
    const onCommit = vi.fn();
    render(<NumericField label="Width" value={40} unit="mm" readOnly onCommit={onCommit} />);

    const input = screen.getByLabelText('Width');
    expect(input).toHaveAttribute('readonly');
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.blur(input);

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits a valid numeric edit on blur', () => {
    const onCommit = vi.fn(() => true);
    render(<NumericField label="Width" value={40} unit="mm" onCommit={onCommit} />);

    const input = screen.getByLabelText('Width');
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledWith(99);
  });

  it('commits a valid numeric edit on Enter', () => {
    const onCommit = vi.fn(() => true);
    render(<NumericField label="Width" value={40} unit="mm" onCommit={onCommit} />);

    const input = screen.getByLabelText('Width');
    fireEvent.change(input, { target: { value: '55' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledWith(55);
  });

  it('shows an error and does not call onCommit for non-numeric input', () => {
    const onCommit = vi.fn();
    render(<NumericField label="Width" value={40} unit="mm" onCommit={onCommit} />);

    const input = screen.getByLabelText('Width');
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(/enter a number/i)).toBeInTheDocument();
  });

  it('shows an error when onCommit rejects the value, keeping the typed text', () => {
    const onCommit = vi.fn(() => false);
    render(<NumericField label="Thickness" value={8} unit="mm" onCommit={onCommit} />);

    const input = screen.getByLabelText('Thickness');
    fireEvent.change(input, { target: { value: '500' } });
    fireEvent.blur(input);

    expect(screen.getByLabelText('Thickness')).toHaveValue(500);
    expect(screen.getByText(/invalid value/i)).toBeInTheDocument();
  });

  it('clears a previous error once a valid commit succeeds', () => {
    const onCommit = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<NumericField label="Thickness" value={8} unit="mm" onCommit={onCommit} />);

    const input = screen.getByLabelText('Thickness');
    fireEvent.change(input, { target: { value: '500' } });
    fireEvent.blur(input);
    expect(screen.getByText(/invalid value/i)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.blur(input);

    expect(screen.queryByText(/invalid value/i)).not.toBeInTheDocument();
  });

  it('reflects an external value change while the field is not focused', () => {
    const { rerender } = render(<NumericField label="Width" value={40} unit="mm" />);

    rerender(<NumericField label="Width" value={70} unit="mm" />);

    expect(screen.getByLabelText('Width')).toHaveValue(70);
  });
});
