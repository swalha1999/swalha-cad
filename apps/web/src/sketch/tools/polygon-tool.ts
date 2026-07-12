import { regularPolygonVertices } from '@swalha-cad/geometry';
import { DEFAULT_POLYGON_SIDES } from './types.js';
import type { PointRef, PolygonToolState, SketchCommit, SnapResult, ToolEvent, ToolResult } from './types.js';

export const initialPolygonToolState: PolygonToolState = {
  tool: 'polygon',
  sides: DEFAULT_POLYGON_SIDES,
  center: null,
  cursor: null,
};

/**
 * Builds a regular polygon of `sides` inscribed in the circle centred on
 * `center` with `vertex` as its first vertex. The first vertex keeps the click's
 * snap reference; the remaining vertices are new. The lines close the loop back
 * to the first vertex. Returns `null` for a zero radius or fewer than three sides.
 */
export function buildPolygonCommit(center: SnapResult, vertex: SnapResult, sides: number): SketchCommit | null {
  const vertices = regularPolygonVertices([center.point.x, center.point.y], [vertex.point.x, vertex.point.y], sides);
  if (!vertices) return null;
  const points: PointRef[] = vertices.map((v, index) =>
    index === 0 ? vertex.ref : ({ kind: 'new', x: v[0], y: v[1] } as PointRef),
  );
  const lines = vertices.map((_, index) => ({ start: index, end: (index + 1) % vertices.length }));
  return { points, lines, circles: [] };
}

/**
 * Regular polygon tool: first click sets the center, second click a vertex
 * (setting circumradius and rotation) that commits the closed loop and resets,
 * preserving the chosen side count for the next polygon. A zero-radius vertex is
 * rejected without mutation. `cancel` (Escape) clears a pending center; with
 * none it deactivates the tool.
 */
export function advancePolygonTool(state: PolygonToolState, event: ToolEvent): ToolResult {
  switch (event.type) {
    case 'move':
      return { state: { ...state, cursor: event.snap.point }, commit: null, exitTool: false };

    case 'click': {
      if (!state.center) {
        return { state: { ...state, center: event.snap, cursor: event.snap.point }, commit: null, exitTool: false };
      }
      // A two-click tool resets fully on the vertex click, whether or not the
      // (possibly degenerate) input produced a commit — like the circle tool.
      const commit = buildPolygonCommit(state.center, event.snap, state.sides);
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
