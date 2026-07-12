import { centerRectangleCorners } from '@swalha-cad/geometry';
import type { PointRef, RectangleCenterToolState, SketchCommit, SnapResult, ToolEvent, ToolResult } from './types.js';

export const initialRectangleCenterToolState: RectangleCenterToolState = {
  tool: 'rectangle-center',
  center: null,
  cursor: null,
};

/**
 * Builds a center rectangle: four corners mirrored about `center`, joined into a
 * closed four-line loop. The clicked `corner` keeps its snap reference (so a
 * corner dropped on an existing point stays coincident); the other three are
 * new. Returns `null` for a degenerate (zero-extent) rectangle.
 */
export function buildCenterRectangleCommit(center: SnapResult, corner: SnapResult): SketchCommit | null {
  const corners = centerRectangleCorners([center.point.x, center.point.y], [corner.point.x, corner.point.y]);
  if (!corners) return null;
  const points: PointRef[] = [
    corner.ref,
    { kind: 'new', x: corners[1][0], y: corners[1][1] },
    { kind: 'new', x: corners[2][0], y: corners[2][1] },
    { kind: 'new', x: corners[3][0], y: corners[3][1] },
  ];
  return {
    points,
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
 * Center rectangle tool: first click sets the center, second click at a corner
 * commits the symmetric rectangle and resets. `cancel` (Escape) clears a pending
 * center; with nothing pending it deactivates the tool.
 */
export function advanceRectangleCenterTool(state: RectangleCenterToolState, event: ToolEvent): ToolResult {
  switch (event.type) {
    case 'move':
      return { state: { ...state, cursor: event.snap.point }, commit: null, exitTool: false };

    case 'click': {
      if (!state.center) {
        return { state: { ...state, center: event.snap, cursor: event.snap.point }, commit: null, exitTool: false };
      }
      const commit = buildCenterRectangleCommit(state.center, event.snap);
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
