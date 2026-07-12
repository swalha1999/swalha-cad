import { Check, X } from 'lucide-react';
import type { ChangeEvent, FormEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCadStore } from '../store/cad-store-context.js';
import {
  listSketchFeatures,
  MAX_EXTRUDE_DEPTH,
  MIN_EXTRUDE_DEPTH,
  validateExtrudeSession,
} from './extrude-session.js';

/**
 * Live-editing depth field for the extrude task. Buffers its own text while
 * focused so an in-progress edit is never clobbered by an external change (the
 * in-canvas manipulator), yet pushes every valid keystroke straight to the store
 * so the 3D preview updates live — keeping the numeric value and the manipulator
 * strictly synchronized in both directions.
 */
function DepthField({ depth, onChange }: { depth: number; onChange: (next: number) => void }) {
  const [text, setText] = useState(String(depth));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(depth));
  }, [depth]);

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const next = event.target.value;
    setText(next);
    const parsed = Number(next);
    if (next.trim() !== '' && Number.isFinite(parsed)) onChange(parsed);
  }

  return (
    <div className="field">
      <label htmlFor="extrude-depth">Depth</label>
      <div className="field__control">
        <input
          id="extrude-depth"
          type="number"
          min={MIN_EXTRUDE_DEPTH}
          max={MAX_EXTRUDE_DEPTH}
          step={1}
          value={text}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            setText(String(depth));
          }}
          onChange={handleChange}
        />
        <span className="field__unit">mm</span>
      </div>
    </div>
  );
}

const DIRECTIONS: { value: 'normal' | 'symmetric'; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'symmetric', label: 'Symmetric' },
];

/**
 * The contextual, nonblocking Extrude task panel (Task 11). It collects the
 * source sketch, operation direction, reverse toggle, and a strictly-positive
 * depth in millimetres, driving a live 3D preview through the store. Confirm
 * commits exactly one feature command and closes; cancel restores the exact
 * prior state. Invalid, open, or ambiguous profiles surface a diagnostic and
 * disable confirmation.
 */
export function ExtrudeDialog() {
  const session = useCadStore((state) => state.extrude);
  // Derive from stable store slices with useMemo: selecting freshly-built arrays
  // or objects directly through useCadStore would break useSyncExternalStore's
  // snapshot caching and loop.
  const document = useCadStore((state) => state.document);
  const sketches = useMemo(() => listSketchFeatures(document), [document]);
  const validation = useMemo(() => (session ? validateExtrudeSession(document, session) : null), [document, session]);
  const setSource = useCadStore((state) => state.setExtrudeSource);
  const setDepth = useCadStore((state) => state.setExtrudeDepth);
  const setDirection = useCadStore((state) => state.setExtrudeDirection);
  const setReverse = useCadStore((state) => state.setExtrudeReverse);
  const confirmExtrude = useCadStore((state) => state.confirmExtrude);
  const cancelExtrude = useCadStore((state) => state.cancelExtrude);

  if (!session) return null;

  const canConfirm = validation?.status === 'ok';
  const editing = session.editingFeatureId !== null;

  function handleConfirm(): void {
    if (canConfirm) confirmExtrude();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    handleConfirm();
  }

  return (
    <form className="extrude-dialog context-panel__content" aria-label="Extrude" onSubmit={handleSubmit}>
      <p className="context-panel__hint">
        {editing ? 'Editing an extruded solid.' : 'Sweep a closed sketch profile into a solid.'}
      </p>

      <div className="field">
        <label htmlFor="extrude-source">Source sketch</label>
        <select
          id="extrude-source"
          className="extrude-dialog__source"
          value={session.sketchId ?? ''}
          onChange={(event) => setSource(event.target.value)}
        >
          <option value="" disabled>
            Select a sketch…
          </option>
          {sketches.map((sketch) => (
            <option key={sketch.id} value={sketch.id}>
              {sketch.name}
            </option>
          ))}
        </select>
      </div>

      <h3 className="context-panel__section">Direction</h3>
      <div className="extrude-dialog__directions" role="group" aria-label="Operation direction">
        {DIRECTIONS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={`btn btn--sm ${session.direction === value ? 'btn--default' : 'btn--outline'}`}
            aria-pressed={session.direction === value}
            onClick={() => setDirection(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <button
        type="button"
        className={`btn btn--sm extrude-dialog__reverse ${session.reverse ? 'btn--default' : 'btn--outline'}`}
        aria-pressed={session.reverse}
        aria-label="Reverse direction"
        disabled={session.direction === 'symmetric'}
        title={session.direction === 'symmetric' ? 'A symmetric extrusion has no reverse' : 'Flip to the opposite side'}
        onClick={() => setReverse(!session.reverse)}
      >
        Reverse direction
      </button>

      <h3 className="context-panel__section">Depth</h3>
      <DepthField depth={session.depth} onChange={setDepth} />

      {validation && validation.status !== 'ok' && validation.message ? (
        <p className="extrude-dialog__diagnostic" role="alert">
          {validation.message}
        </p>
      ) : null}

      <div className="extrude-dialog__actions">
        <button
          type="submit"
          className="btn btn--sm btn--default extrude-dialog__confirm"
          aria-label="Confirm extrude"
          disabled={!canConfirm}
          onClick={handleConfirm}
        >
          <Check aria-hidden="true" />
          Confirm
        </button>
        <button
          type="button"
          className="btn btn--sm btn--outline extrude-dialog__cancel"
          aria-label="Cancel extrude"
          onClick={() => cancelExtrude()}
        >
          <X aria-hidden="true" />
          Cancel
        </button>
      </div>
    </form>
  );
}
