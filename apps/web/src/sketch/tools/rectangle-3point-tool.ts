import { threePointRectangleCorners } from '@swalha-cad/geometry';
import type { PointRef, Rectangle3PointToolState, SketchCommit, SnapResult, ToolEvent, ToolResult } from './types.js';

export const initialRectangle3PointToolState: Rectangle3PointToolState = {
  tool: 'rectangle-3point',
  start: null,
  edgeEnd: null,
  cursor: null,
};

/**
 * Builds a three-point rectangle: `start`→`edgeEnd` is the first edge; `width`
 * projects onto the edge's perpendicular. The two edge points keep their snap
 * references; the two derived corners are new. Returns `null` when the first
 * edge is zero-length or the width point lies on the edge line.
 */
export function buildThreePointRectangleCommit(start: SnapResult, edgeEnd: SnapResult, width: SnapResult): SketchCommit | null {
  const corners = threePointRectangleCorners(
    [start.point.x, start.point.y],
    [edgeEnd.point.x, edgeEnd.point.y],
    [width.point.x, width.point.y],
  );
  if (!corners) return null;
  const points: PointRef[] = [
    start.ref,
    edgeEnd.ref,
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
 * Three-point rectangle tool: first click sets an edge corner, second click the
 * other edge corner, third click the perpendicular width (committing and
 * resetting). A degenerate width leaves the edge pending so the user can retry.
 * `cancel` (Escape) unwinds the pending steps one at a time, then deactivates.
 */
export function advanceRectangle3PointTool(state: Rectangle3PointToolState, event: ToolEvent): ToolResult {
  switch (event.type) {
    case 'move':
      return { state: { ...state, cursor: event.snap.point }, commit: null, exitTool: false };

    case 'click': {
      if (!state.start) {
        return { state: { ...state, start: event.snap, cursor: event.snap.point }, commit: null, exitTool: false };
      }
      if (!state.edgeEnd) {
        return { state: { ...state, edgeEnd: event.snap, cursor: event.snap.point }, commit: null, exitTool: false };
      }
      const commit = buildThreePointRectangleCommit(state.start, state.edgeEnd, event.snap);
      if (!commit) {
        // Degenerate width: reject visibly, keep the edge so a valid width can be picked.
        return { state, commit: null, exitTool: false };
      }
      return { state: { ...state, start: null, edgeEnd: null }, commit, exitTool: false };
    }

    case 'finish':
      return { state, commit: null, exitTool: false };

    case 'cancel':
      if (state.edgeEnd) {
        return { state: { ...state, edgeEnd: null }, commit: null, exitTool: false };
      }
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
