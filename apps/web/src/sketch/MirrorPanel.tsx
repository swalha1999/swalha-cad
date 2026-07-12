import { Check, X } from 'lucide-react';
import { useCadStore } from '../store/cad-store-context.js';
import type { MirrorState } from '../store/cad-store.js';

/** The instruction shown for each Mirror collector phase. */
function instruction(mirror: MirrorState): string {
  if (mirror.phase === 'sources') {
    return mirror.sourceIds.length === 0
      ? 'Select the points, lines, circles, or arcs to mirror.'
      : `${mirror.sourceIds.length} selected — add more, or choose the mirror axis.`;
  }
  if (mirror.phase === 'axis') return 'Click the straight line to mirror across.';
  return 'Confirm the mirror, or cancel to change the axis.';
}

/**
 * The Onshape-style nonblocking Mirror collector panel: a small, always-visible
 * floating control anchored over the sketch canvas that reflects the tool's
 * current phase (collecting sources, picking the axis, or confirming) and exposes
 * stable, accessible controls — a "Choose axis" step, a checkmark to confirm, and
 * a Cancel that steps back one layer at a time. All committing/cancelling routes
 * through the store, so the document is only ever touched by a single undoable
 * `feature.update` on confirmation. The panel is keyboard reachable and every
 * button carries an explicit accessible name.
 */
export function MirrorPanel() {
  const mirror = useCadStore((state) => state.sketch?.mirror ?? null);
  const chooseAxis = useCadStore((state) => state.mirrorChooseAxis);
  const confirmMirror = useCadStore((state) => state.confirmMirror);
  const cancelMirror = useCadStore((state) => state.cancelMirror);

  if (!mirror) return null;

  return (
    <div className="mirror-panel" role="group" aria-label="Mirror">
      <div className="mirror-panel__body">
        <span className="mirror-panel__title">Mirror</span>
        <span className="mirror-panel__hint" data-testid="mirror-instruction">
          {instruction(mirror)}
        </span>
      </div>
      <div className="mirror-panel__actions">
        {mirror.phase === 'sources' ? (
          <button
            type="button"
            className="btn btn--default btn--sm"
            aria-label="Choose axis"
            disabled={mirror.sourceIds.length === 0}
            onClick={() => chooseAxis()}
          >
            Choose axis
          </button>
        ) : null}
        {mirror.phase === 'confirm' ? (
          <button
            type="button"
            className="btn btn--default btn--sm mirror-panel__confirm"
            aria-label="Confirm mirror"
            onClick={() => confirmMirror()}
          >
            <Check aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--ghost btn--sm mirror-panel__cancel"
          aria-label="Cancel mirror"
          onClick={() => cancelMirror()}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
