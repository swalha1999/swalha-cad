import type { KeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

export interface NumericFieldProps {
  label: string;
  value: number;
  unit?: string;
  readOnly?: boolean;
  /** Returns whether the value was accepted; a `false` return renders an inline error. */
  onCommit?: (next: number) => boolean;
}

function fieldId(label: string): string {
  return `field-${label.toLowerCase().replace(/\s+/g, '-')}`;
}

/**
 * A number input that buffers its own text while focused so an in-progress
 * edit (including a momentarily invalid one) is never clobbered by the
 * `value` prop, and only reaches out to `onCommit` once the user finishes
 * editing (blur or Enter).
 */
export function NumericField({ label, value, unit, readOnly, onCommit }: NumericFieldProps) {
  const id = fieldId(label);
  const [text, setText] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const isFocused = useRef(false);

  useEffect(() => {
    if (!isFocused.current) {
      setText(String(value));
      setError(null);
    }
  }, [value]);

  function commit(): void {
    const parsed = Number(text);
    if (text.trim() === '' || !Number.isFinite(parsed)) {
      setError('Enter a number');
      return;
    }
    const accepted = onCommit ? onCommit(parsed) : true;
    setError(accepted ? null : 'Invalid value');
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter' && !readOnly) {
      commit();
    }
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field__control">
        <input
          id={id}
          type="number"
          readOnly={readOnly}
          value={text}
          onFocus={() => {
            isFocused.current = true;
          }}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => {
            isFocused.current = false;
            if (!readOnly) commit();
          }}
          onKeyDown={handleKeyDown}
        />
        {unit ? <span className="field__unit">{unit}</span> : null}
      </div>
      {error ? <span className="field__error">{error}</span> : null}
    </div>
  );
}
