import { Check, X } from 'lucide-react';
import type { SketchSupport } from '../store/cad-store.js';
import { useCadStore } from '../store/cad-store-context.js';
import { IconButton } from '../components/ui/IconButton.js';

const PLANE_SUPPORT_LABEL = { XY: 'Top plane', XZ: 'Front plane', YZ: 'Right plane' } as const;

/** A short human description of the collected support, for the collector field. */
function supportLabel(support: SketchSupport | null): string | null {
  if (!support) return null;
  return support.kind === 'plane' ? PLANE_SUPPORT_LABEL[support.plane] : 'Planar face';
}

/**
 * The compact right-hand task panel for the Sketch support-selection command
 * (the reference's "Sketch 1" panel). It hosts a single required "Sketch plane"
 * collector that fills in as the user clicks a plane/face, plus checkmark/cancel
 * controls. The confirm control (and thus sketch creation) stays disabled until
 * a support is collected; cancelling restores the prior state without mutation.
 */
export function SketchSupportPanel() {
  const session = useCadStore((state) => state.sketchSupport);
  const confirmSketchSupport = useCadStore((state) => state.confirmSketchSupport);
  const cancelSketchSupport = useCadStore((state) => state.cancelSketchSupport);

  if (!session) return null;
  const label = supportLabel(session.support);
  const hasSupport = session.support !== null;

  return (
    <form
      className="sketch-support-panel"
      aria-label="Sketch"
      onSubmit={(event) => {
        event.preventDefault();
        confirmSketchSupport();
      }}
    >
      <div className="sketch-support-panel__header">
        <h3 className="context-panel__section">{session.draftName}</h3>
        <div className="sketch-support-panel__actions">
          <IconButton
            type="submit"
            aria-label="Create sketch"
            variant="ghost"
            disabled={!hasSupport}
            icon={<Check />}
          />
          <IconButton
            type="button"
            aria-label="Cancel sketch"
            variant="ghost"
            icon={<X />}
            onClick={() => cancelSketchSupport()}
          />
        </div>
      </div>

      <div className="field sketch-support-panel__collector">
        <label id="sketch-plane-collector-label" htmlFor="sketch-plane-collector">
          Sketch plane
          <span className="sketch-support-panel__required" aria-hidden="true">
            {' '}*
          </span>
        </label>
        <output
          id="sketch-plane-collector"
          aria-labelledby="sketch-plane-collector-label"
          className={`sketch-support-panel__value${hasSupport ? ' sketch-support-panel__value--filled' : ''}`}
          data-filled={hasSupport}
        >
          {label ?? 'Select a plane or planar face'}
        </output>
      </div>

      {session.error ? (
        <p className="sketch-support-panel__error" role="alert">
          {session.error}
        </p>
      ) : null}
    </form>
  );
}
