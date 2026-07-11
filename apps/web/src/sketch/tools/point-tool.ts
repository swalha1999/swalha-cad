import type { PointToolState, ToolEvent, ToolResult } from './types.js';

/** The point tool holds no pending state; every click is a complete action. */
export const initialPointToolState: PointToolState = { tool: 'point' };

/**
 * Point tool: a single click commits one standalone point at the snapped
 * position. `finish` is a no-op (nothing to finish); `cancel` (Escape) has no
 * pending step, so it asks the store to deactivate the tool.
 */
export function advancePointTool(state: PointToolState, event: ToolEvent): ToolResult {
  switch (event.type) {
    case 'click':
      return {
        state,
        commit: { points: [event.snap.ref], lines: [], circles: [] },
        exitTool: false,
      };
    case 'move':
    case 'finish':
      return { state, commit: null, exitTool: false };
    case 'cancel':
      return { state, commit: null, exitTool: true };
    default: {
      const exhaustive: never = event;
      throw new Error(`Unknown tool event: ${JSON.stringify(exhaustive)}`);
    }
  }
}
