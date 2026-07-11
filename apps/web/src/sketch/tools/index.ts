import { advanceCircleTool, initialCircleToolState } from './circle-tool.js';
import { advanceLineTool, initialLineToolState } from './line-tool.js';
import { advancePointTool, initialPointToolState } from './point-tool.js';
import { advanceRectangleTool, initialRectangleToolState } from './rectangle-tool.js';
import type { SketchToolKind, ToolEvent, ToolResult, ToolState } from './types.js';

/** The pending state a freshly selected tool starts from. */
export function initialToolState(kind: SketchToolKind): ToolState {
  switch (kind) {
    case 'point':
      return initialPointToolState;
    case 'line':
      return initialLineToolState;
    case 'rectangle':
      return initialRectangleToolState;
    case 'circle':
      return initialCircleToolState;
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown sketch tool: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Advances whichever tool `state` describes, dispatching to its pure reducer. */
export function advanceTool(state: ToolState, event: ToolEvent): ToolResult {
  switch (state.tool) {
    case 'point':
      return advancePointTool(state, event);
    case 'line':
      return advanceLineTool(state, event);
    case 'rectangle':
      return advanceRectangleTool(state, event);
    case 'circle':
      return advanceCircleTool(state, event);
    default: {
      const exhaustive: never = state;
      throw new Error(`Unknown tool state: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export { advanceCircleTool, buildCircleCommit, initialCircleToolState } from './circle-tool.js';
export { advanceLineTool, initialLineToolState } from './line-tool.js';
export { advancePointTool, initialPointToolState } from './point-tool.js';
export { advanceRectangleTool, buildRectangleCommit, initialRectangleToolState } from './rectangle-tool.js';
export type * from './types.js';
