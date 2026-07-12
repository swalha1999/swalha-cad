import { tangentArc } from '@swalha-cad/geometry';
import type { ArcTangentToolState, SketchCommit, SnapResult, ToolEvent, ToolResult, Vec2 } from './types.js';

export const initialArcTangentToolState: ArcTangentToolState = { tool: 'arc-tangent', start: null, tangent: null, cursor: null };

/**
 * Builds a tangent-continuation arc commit: the arc leaves `start` along the
 * seeded `tangent` direction and ends at `end`; its center becomes a new point
 * entity that the arc references. Returns `null` when there is no tangent, or when
 * the arc is degenerate (target along the tangent line, zero span), so the tool
 * rejects the click without mutating the document.
 */
export function buildTangentArcCommit(start: SnapResult, tangent: Vec2 | null, end: SnapResult): SketchCommit | null {
  if (!tangent) return null;
  const arc = tangentArc([start.point.x, start.point.y], [tangent.x, tangent.y], [end.point.x, end.point.y]);
  if (!arc) return null;
  return {
    points: [{ kind: 'new', x: arc.center[0], y: arc.center[1] }],
    lines: [],
    circles: [],
    arcs: [{ center: 0, radius: arc.radius, startAngle: arc.startAngle, endAngle: arc.endAngle, direction: arc.direction }],
  };
}

/**
 * Tangent arc tool: the first click sets the start point (the store then injects
 * the tangent direction from the sketch geometry at that point); the second click
 * sets the end and commits an arc tangent to that direction. A degenerate arc, or
 * a start with no incident tangent, is rejected without mutation. Escape clears the
 * pending start, then deactivates the tool.
 */
export function advanceArcTangentTool(state: ArcTangentToolState, event: ToolEvent): ToolResult {
  switch (event.type) {
    case 'move':
      return { state: { ...state, cursor: event.snap.point }, commit: null, exitTool: false };

    case 'click': {
      if (!state.start) {
        return { state: { ...state, start: event.snap, cursor: event.snap.point }, commit: null, exitTool: false };
      }
      const commit = buildTangentArcCommit(state.start, state.tangent, event.snap);
      if (!commit) return { state, commit: null, exitTool: false };
      return { state: { ...state, start: null, tangent: null }, commit, exitTool: false };
    }

    case 'finish':
      return { state, commit: null, exitTool: false };

    case 'cancel':
      if (state.start) return { state: { ...state, start: null, tangent: null }, commit: null, exitTool: false };
      return { state, commit: null, exitTool: true };

    default: {
      const exhaustive: never = event;
      throw new Error(`Unknown tool event: ${JSON.stringify(exhaustive)}`);
    }
  }
}
