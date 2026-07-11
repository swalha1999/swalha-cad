import type { CircleToolState, SketchCommit, SnapResult, ToolEvent, ToolResult } from './types.js';

export const initialCircleToolState: CircleToolState = { tool: 'circle', center: null, cursor: null };

function distance(a: SnapResult, b: SnapResult): number {
  return Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y);
}

/** Builds a circle from a center point and a rim point; `null` for a zero radius. */
export function buildCircleCommit(center: SnapResult, rim: SnapResult): SketchCommit | null {
  const radius = distance(center, rim);
  if (radius <= 0) return null;
  return { points: [center.ref], lines: [], circles: [{ center: 0, radius }] };
}

/**
 * Circle tool: first click sets the center, second click sets the radius from
 * the center-to-cursor distance and commits. `cancel` (Escape) clears a pending
 * center; with nothing pending it deactivates the tool.
 */
export function advanceCircleTool(state: CircleToolState, event: ToolEvent): ToolResult {
  switch (event.type) {
    case 'move':
      return { state: { ...state, cursor: event.snap.point }, commit: null, exitTool: false };

    case 'click': {
      if (!state.center) {
        return { state: { ...state, center: event.snap, cursor: event.snap.point }, commit: null, exitTool: false };
      }
      const commit = buildCircleCommit(state.center, event.snap);
      return { state: { ...state, center: null }, commit, exitTool: false };
    }

    case 'finish':
      return { state, commit: null, exitTool: false };

    case 'cancel':
      if (state.center) {
        return { state: { ...state, center: null }, commit: null, exitTool: false };
      }
      return { state, commit: null, exitTool: true };

    default: {
      const exhaustive: never = event;
      throw new Error(`Unknown tool event: ${JSON.stringify(exhaustive)}`);
    }
  }
}
