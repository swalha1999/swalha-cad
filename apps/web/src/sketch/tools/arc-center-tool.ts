import { centerPointArc } from '@swalha-cad/geometry';
import type { ArcCenterToolState, SketchCommit, SnapResult, ToolEvent, ToolResult } from './types.js';

export const initialArcCenterToolState: ArcCenterToolState = { tool: 'arc-center', center: null, start: null, cursor: null };

/**
 * Builds a center-point arc commit: the `center` becomes a point entity and the
 * arc references it, sweeping from the `start` ray toward `through`. Endpoints are
 * derived (never stored). Returns `null` for a degenerate (zero radius / zero
 * sweep) arc so the tool can reject it without mutating the document.
 */
export function buildCenterArcCommit(center: SnapResult, start: SnapResult, through: SnapResult): SketchCommit | null {
  const arc = centerPointArc(
    [center.point.x, center.point.y],
    [start.point.x, start.point.y],
    [through.point.x, through.point.y],
  );
  if (!arc) return null;
  return {
    points: [center.ref],
    lines: [],
    circles: [],
    arcs: [{ center: 0, radius: arc.radius, startAngle: arc.startAngle, endAngle: arc.endAngle, direction: arc.direction }],
  };
}

/**
 * Center-point arc tool: first click sets the center, the second the radius/start
 * ray, the third the sweep direction and commits. A second click coincident with
 * the center (zero radius) is ignored so the user can pick a valid start. Escape
 * peels back one step at a time (start, then center), then deactivates the tool.
 */
export function advanceArcCenterTool(state: ArcCenterToolState, event: ToolEvent): ToolResult {
  switch (event.type) {
    case 'move':
      return { state: { ...state, cursor: event.snap.point }, commit: null, exitTool: false };

    case 'click': {
      if (!state.center) {
        return { state: { ...state, center: event.snap, cursor: event.snap.point }, commit: null, exitTool: false };
      }
      if (!state.start) {
        const zeroRadius = event.snap.point.x === state.center.point.x && event.snap.point.y === state.center.point.y;
        if (zeroRadius) return { state, commit: null, exitTool: false };
        return { state: { ...state, start: event.snap, cursor: event.snap.point }, commit: null, exitTool: false };
      }
      const commit = buildCenterArcCommit(state.center, state.start, event.snap);
      if (!commit) return { state, commit: null, exitTool: false };
      return { state: { ...state, center: null, start: null }, commit, exitTool: false };
    }

    case 'finish':
      return { state, commit: null, exitTool: false };

    case 'cancel':
      if (state.start) return { state: { ...state, start: null }, commit: null, exitTool: false };
      if (state.center) return { state: { ...state, center: null }, commit: null, exitTool: false };
      return { state, commit: null, exitTool: true };

    default: {
      const exhaustive: never = event;
      throw new Error(`Unknown tool event: ${JSON.stringify(exhaustive)}`);
    }
  }
}
