import type { KeyboardEvent } from 'react';
import { useEffect, useId, useRef } from 'react';
import type { DeletionPlan } from '@swalha-cad/document';

export interface DeleteConfirmDialogProps {
  plan: DeletionPlan;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Focused impact/confirmation dialog shown before a deletion that would cascade
 * to downstream dependents. It names the target, lists every feature that would
 * also be removed, and offers Cancel or a destructive Delete. Rendered as an
 * `alertdialog`; Escape cancels and focus opens on Cancel so the safe choice is
 * default. Confirming performs one atomic dependency-aware transaction.
 */
export function DeleteConfirmDialog({ plan, onConfirm, onCancel }: DeleteConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <div className="dialog-overlay" onKeyDown={handleKeyDown}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId}>
        <h2 id={titleId} className="dialog__title">
          Delete {plan.targetName}?
        </h2>
        <p id={descId} className="dialog__body">
          Deleting <strong>{plan.targetName}</strong> will also delete {plan.dependents.length} dependent
          {plan.dependents.length === 1 ? ' feature' : ' features'} that rely on it:
        </p>
        <ul className="dialog__impact-list">
          {plan.dependents.map((dependent) => (
            <li key={dependent.id}>{dependent.name}</li>
          ))}
        </ul>
        <div className="dialog__actions">
          <button type="button" className="btn btn--outline btn--sm" ref={cancelRef} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn--destructive btn--sm" onClick={onConfirm}>
            Delete anyway
          </button>
        </div>
      </div>
    </div>
  );
}
