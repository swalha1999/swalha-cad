import { circumcircle } from '@swalha-cad/geometry';
import type { Circle3PointToolState, SketchCommit, SnapResult, ToolEvent, ToolResult } from './types.js';

export const initialCircle3PointToolState: Circle3PointToolState = { tool: 'circle-3point', points: [], cursor: null };

/**
 * Builds a circle through three rim points from their circumcircle: one new
 * center point at the (stable, order-independent) circumcenter plus a circle of
 * the circumradius. Returns `null` when the three points are collinear.
 */
export function buildThreePointCircleCommit(a: SnapResult, b: SnapResult, c: SnapResult): SketchCommit | null {
  const circle = circumcircle([a.point.x, a.point.y], [b.point.x, b.point.y], [c.point.x, c.point.y]);
  if (!circle) return null;
  return {
    points: [{ kind: 'new', x: circle.center[0], y: circle.center[1] }],
    lines: [],
    circles: [{ center: 0, radius: circle.radius }],
  };
}

/**
 * Three-point circle tool: each click adds a rim point; the third click builds
 * the circumcircle and resets. Collinear (degenerate) third points are rejected
 * without mutation, leaving the first two so a valid third can be picked.
 * `cancel` (Escape) drops the pending rim points; with none it deactivates.
 */
export function advanceCircle3PointTool(state: Circle3PointToolState, event: ToolEvent): ToolResult {
  switch (event.type) {
    case 'move':
      return { state: { ...state, cursor: event.snap.point }, commit: null, exitTool: false };

    case 'click': {
      if (state.points.length < 2) {
        return { state: { ...state, points: [...state.points, event.snap], cursor: event.snap.point }, commit: null, exitTool: false };
      }
      const [a, b] = state.points;
      const commit = buildThreePointCircleCommit(a!, b!, event.snap);
      if (!commit) {
        // Collinear: reject visibly, keep the first two points for another try.
        return { state, commit: null, exitTool: false };
      }
      return { state: { ...state, points: [] }, commit, exitTool: false };
    }

    case 'finish':
      return { state, commit: null, exitTool: false };

    case 'cancel':
      if (state.points.length > 0) {
        return { state: { ...state, points: [] }, commit: null, exitTool: false };
      }
      return { state, commit: null, exitTool: true };

    default: {
      const exhaustive: never = event;
      throw new Error(`Unknown tool event: ${JSON.stringify(exhaustive)}`);
    }
  }
}
