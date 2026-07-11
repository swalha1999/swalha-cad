import type { RectangleToolState, SketchCommit, SnapResult, ToolEvent, ToolResult } from './types.js';

export const initialRectangleToolState: RectangleToolState = { tool: 'rectangle', start: null, cursor: null };

/**
 * Builds an axis-aligned rectangle from two opposite corners: four points
 * (the two clicked corners plus the two derived corners) joined by four lines.
 * Returns `null` for a degenerate (zero-width or zero-height) rectangle.
 */
export function buildRectangleCommit(start: SnapResult, end: SnapResult): SketchCommit | null {
  const { x: sx, y: sy } = start.point;
  const { x: ex, y: ey } = end.point;
  if (sx === ex || sy === ey) return null;

  return {
    points: [
      start.ref,
      { kind: 'new', x: ex, y: sy },
      end.ref,
      { kind: 'new', x: sx, y: ey },
    ],
    lines: [
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 },
      { start: 3, end: 0 },
    ],
    circles: [],
  };
}

/**
 * Rectangle tool: first click sets a corner, second click at the opposite
 * corner commits the rectangle and resets. `cancel` (Escape) clears a pending
 * first corner; with nothing pending it deactivates the tool.
 */
export function advanceRectangleTool(state: RectangleToolState, event: ToolEvent): ToolResult {
  switch (event.type) {
    case 'move':
      return { state: { ...state, cursor: event.snap.point }, commit: null, exitTool: false };

    case 'click': {
      if (!state.start) {
        return { state: { ...state, start: event.snap, cursor: event.snap.point }, commit: null, exitTool: false };
      }
      const commit = buildRectangleCommit(state.start, event.snap);
      return { state: { ...state, start: null }, commit, exitTool: false };
    }

    case 'finish':
      return { state, commit: null, exitTool: false };

    case 'cancel':
      if (state.start) {
        return { state: { ...state, start: null }, commit: null, exitTool: false };
      }
      return { state, commit: null, exitTool: true };

    default: {
      const exhaustive: never = event;
      throw new Error(`Unknown tool event: ${JSON.stringify(exhaustive)}`);
    }
  }
}
