import type { LineToolState, SketchCommit, SnapResult, ToolEvent, ToolResult } from './types.js';

export const initialLineToolState: LineToolState = { tool: 'line', vertices: [], cursor: null };

/** Builds a connected-polyline commit: every vertex is a point, consecutive vertices a line. */
function buildChainCommit(vertices: SnapResult[]): SketchCommit {
  const lines: { start: number; end: number }[] = [];
  for (let i = 1; i < vertices.length; i++) {
    lines.push({ start: i - 1, end: i });
  }
  return { points: vertices.map((vertex) => vertex.ref), lines, circles: [] };
}

/**
 * Connected line tool: each click appends a vertex to the in-progress chain,
 * which is only committed (as one undoable operation) when `finish`
 * (Enter/double-click) is received with at least two vertices. Consecutive
 * segments share a vertex, so the joints are coincident by construction.
 * `cancel` (Escape) drops an in-progress chain but keeps the tool active; with
 * no chain pending it deactivates the tool.
 */
export function advanceLineTool(state: LineToolState, event: ToolEvent): ToolResult {
  switch (event.type) {
    case 'move':
      return { state: { ...state, cursor: event.snap.point }, commit: null, exitTool: false };

    case 'click':
      return {
        state: { ...state, vertices: [...state.vertices, event.snap], cursor: event.snap.point },
        commit: null,
        exitTool: false,
      };

    case 'finish': {
      if (state.vertices.length >= 2) {
        return {
          state: { ...state, vertices: [] },
          commit: buildChainCommit(state.vertices),
          exitTool: false,
        };
      }
      return { state: { ...state, vertices: [] }, commit: null, exitTool: false };
    }

    case 'cancel':
      if (state.vertices.length > 0) {
        return { state: { ...state, vertices: [] }, commit: null, exitTool: false };
      }
      return { state, commit: null, exitTool: true };

    default: {
      const exhaustive: never = event;
      throw new Error(`Unknown tool event: ${JSON.stringify(exhaustive)}`);
    }
  }
}
