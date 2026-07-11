import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useCadStore } from '../store/cad-store-context.js';

/** Compact numeric prefill: up to three decimals, trailing zeros trimmed. */
function formatMeasured(value: number): string {
  return Number.parseFloat(value.toFixed(3)).toString();
}

/**
 * The Onshape-style inline value editor for the Distance/Dimension tool, anchored
 * beside the live dimension annotation. It opens prefilled with the current
 * measured length (mm) and auto-focused for typing. Enter commits the value
 * through the store (feature-command history + solver); Escape cancels without
 * mutation. Enter/Escape are stopped from bubbling so the window-level sketch
 * shortcuts never also fire. A rejected value (non-positive, conflicting, or
 * already-constrained) is shown inline and the editor stays open to be corrected.
 */
export function DimensionPrompt({ measured }: { measured: number }) {
  const commitDimension = useCadStore((state) => state.commitDimension);
  const cancelDimension = useCadStore((state) => state.cancelDimension);
  const [text, setText] = useState(() => formatMeasured(measured));
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
    const outcome = commitDimension(parsed);
    if (!outcome.applied) setError(outcome.message ?? 'Invalid value');
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelDimension();
    }
  }

  return (
    <div className="dimension-prompt" role="group" aria-label="Distance dimension">
      <div className="dimension-prompt__row">
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          className="dimension-prompt__input"
          aria-label="Dimension value"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
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
