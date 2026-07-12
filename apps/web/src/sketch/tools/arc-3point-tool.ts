import { threePointArc } from '@swalha-cad/geometry';
import type { Arc3PointToolState, SketchCommit, SnapResult, ToolEvent, ToolResult } from './types.js';

export const initialArc3PointToolState: Arc3PointToolState = { tool: 'arc-3point', start: null, end: null, cursor: null };

/**
 * Builds a three-point arc commit from the two endpoints and a point the arc
 * passes through: the circumcenter becomes a new point entity that the arc
 * references. Returns `null` for collinear/coincident points so the tool rejects
 * the click without mutating the document.
 */
export function buildThreePointArcCommit(start: SnapResult, end: SnapResult, through: SnapResult): SketchCommit | null {
  const arc = threePointArc([start.point.x, start.point.y], [through.point.x, through.point.y], [end.point.x, end.point.y]);
  if (!arc) return null;
  return {
    points: [{ kind: 'new', x: arc.center[0], y: arc.center[1] }],
    lines: [],
    circles: [],
    arcs: [{ center: 0, radius: arc.radius, startAngle: arc.startAngle, endAngle: arc.endAngle, direction: arc.direction }],
  };
}

/**
 * Three-point arc tool: the first two clicks set the arc's endpoints, the third a
 * point the arc passes through, which commits. A collinear third point is rejected
 * without mutation, keeping the two endpoints so a valid one can be picked. Escape
 * peels back one endpoint at a time, then deactivates the tool.
 */
export function advanceArc3PointTool(state: Arc3PointToolState, event: ToolEvent): ToolResult {
  switch (event.type) {
    case 'move':
      return { state: { ...state, cursor: event.snap.point }, commit: null, exitTool: false };

    case 'click': {
      if (!state.start) {
        return { state: { ...state, start: event.snap, cursor: event.snap.point }, commit: null, exitTool: false };
      }
      if (!state.end) {
        return { state: { ...state, end: event.snap, cursor: event.snap.point }, commit: null, exitTool: false };
      }
      const commit = buildThreePointArcCommit(state.start, state.end, event.snap);
      if (!commit) return { state, commit: null, exitTool: false };
      return { state: { ...state, start: null, end: null }, commit, exitTool: false };
    }

    case 'finish':
      return { state, commit: null, exitTool: false };

    case 'cancel':
      if (state.end) return { state: { ...state, end: null }, commit: null, exitTool: false };
      if (state.start) return { state: { ...state, start: null }, commit: null, exitTool: false };
      return { state, commit: null, exitTool: true };

    default: {
      const exhaustive: never = event;
      throw new Error(`Unknown tool event: ${JSON.stringify(exhaustive)}`);
    }
  }
}
