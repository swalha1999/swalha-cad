import { MoveVertical } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useRef } from 'react';
import { useCadStore } from '../store/cad-store-context.js';
import { MAX_EXTRUDE_DEPTH, MIN_EXTRUDE_DEPTH } from './extrude-session.js';

/** Millimetres of depth per pixel of vertical drag — 100px of drag ≈ 25mm. */
const MM_PER_PIXEL = 0.25;
const ARROW_STEP = 1;
const PAGE_STEP = 10;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The in-canvas depth manipulator for the active extrude task (Task 11): a
 * draggable handle overlaid on the viewport, kept strictly synchronized with the
 * numeric depth field — both read and write the same store value, so dragging the
 * handle moves the number and the live 3D preview, and typing a depth moves the
 * handle. Exposed as an accessible vertical slider (pointer drag plus keyboard),
 * so it is operable and testable without WebGL picking. Renders nothing unless an
 * extrude task is open.
 */
export function ExtrudePreview() {
  const session = useCadStore((state) => state.extrude);
  const setDepth = useCadStore((state) => state.setExtrudeDepth);
  const drag = useRef<{ startY: number; startDepth: number } | null>(null);

  if (!session) return null;

  const depth = session.depth;

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startDepth: depth };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!drag.current) return;
    // Dragging up (smaller clientY) increases depth.
    const deltaMm = (drag.current.startY - event.clientY) * MM_PER_PIXEL;
    setDepth(drag.current.startDepth + deltaMm);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!drag.current) return;
    drag.current = null;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    let next: number;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = depth + ARROW_STEP;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        next = depth - ARROW_STEP;
        break;
      case 'PageUp':
        next = depth + PAGE_STEP;
        break;
      case 'PageDown':
        next = depth - PAGE_STEP;
        break;
      case 'Home':
        next = MIN_EXTRUDE_DEPTH;
        break;
      case 'End':
        next = MAX_EXTRUDE_DEPTH;
        break;
      default:
        return;
    }
    event.preventDefault();
    setDepth(next);
  }

  return (
    <div className="extrude-preview" aria-hidden={false}>
      <div
        className="extrude-preview__handle"
        role="slider"
        tabIndex={0}
        aria-label="Extrude depth"
        aria-orientation="vertical"
        aria-valuemin={MIN_EXTRUDE_DEPTH}
        aria-valuemax={MAX_EXTRUDE_DEPTH}
        aria-valuenow={round(depth)}
        aria-valuetext={`${round(depth)} mm`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleKeyDown}
      >
        <MoveVertical aria-hidden="true" />
        <span className="extrude-preview__value">{round(depth)} mm</span>
      </div>
    </div>
  );
}
