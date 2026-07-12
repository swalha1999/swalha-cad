import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useCadStore } from '../store/cad-store-context.js';

/** Compact numeric prefill: up to three decimals, trailing zeros trimmed. */
function formatRadius(value: number): string {
  return Number.parseFloat(value.toFixed(3)).toString();
}

/**
 * The Onshape-style inline radius editor for the Fillet tool, anchored beside the
 * previewed tangent arc. It opens prefilled with the suggested radius (mm) and
 * auto-focused for typing. Each keystroke updates the store's live radius so the
 * arc preview tracks the value; Enter commits it through the store (one
 * feature-command + solver update); Escape cancels without mutation. Enter/Escape
 * are stopped from bubbling so the window-level sketch shortcuts never also fire.
 * A rejected radius (non-positive, oversized, or a degenerate corner) is shown
 * inline and the editor stays open to be corrected.
 */
export function FilletPrompt({ radius }: { radius: number }) {
  const commitFillet = useCadStore((state) => state.commitFillet);
  const cancelFillet = useCadStore((state) => state.cancelFillet);
  const setFilletRadius = useCadStore((state) => state.setFilletRadius);
  const [text, setText] = useState(() => formatRadius(radius));
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  function commit(): void {
    const parsed = Number(text);
    if (text.trim() === '' || !Number.isFinite(parsed)) {
      setError('Enter a number');
      return;
    }
    const outcome = commitFillet(parsed);
    if (!outcome.applied) setError(outcome.message ?? 'Invalid radius');
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelFillet();
    }
  }

  return (
    <div className="dimension-prompt fillet-prompt" role="group" aria-label="Fillet">
      <div className="dimension-prompt__row">
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          className="dimension-prompt__input"
          aria-label="Fillet radius"
          value={text}
          onChange={(event) => {
            const value = event.target.value;
            setText(value);
            setError(null);
            const parsed = Number(value);
            if (value.trim() !== '' && Number.isFinite(parsed)) setFilletRadius(parsed);
          }}
          onKeyDown={handleKeyDown}
        />
        <span className="dimension-prompt__unit">mm</span>
      </div>
      {error ? (
        <span className="dimension-prompt__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
