import type { DeletionPlan } from '@swalha-cad/document';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeleteConfirmDialog } from './DeleteConfirmDialog.js';

function plan(): DeletionPlan {
  return {
    command: {
      type: 'batch',
      commands: [
        { type: 'feature.delete', id: 'ex-1' },
        { type: 'feature.delete', id: 'sk-1' },
      ],
    },
    targetKind: 'feature',
    targetId: 'sk-1',
    targetName: 'Sketch 1',
    dependents: [{ id: 'ex-1', name: 'Extrude 1' }],
  };
}

describe('DeleteConfirmDialog', () => {
  it('is an accessible alertdialog naming the target and listing dependents', () => {
    render(<DeleteConfirmDialog plan={plan()} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: /Delete Sketch 1/ })).toBeInTheDocument();
    expect(screen.getByText('Extrude 1')).toBeInTheDocument();
  });

  it('focuses the Cancel button by default so the safe choice is default', () => {
    render(<DeleteConfirmDialog plan={plan()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('invokes onConfirm when Delete anyway is chosen', () => {
    const onConfirm = vi.fn();
    render(<DeleteConfirmDialog plan={plan()} onConfirm={onConfirm} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete anyway' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('invokes onCancel on the Cancel button and on Escape', () => {
    const onCancel = vi.fn();
    render(<DeleteConfirmDialog plan={plan()} onConfirm={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
