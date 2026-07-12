import { advanceCircleTool, initialCircleToolState } from './circle-tool.js';
import { advanceCircle3PointTool, initialCircle3PointToolState } from './circle-3point-tool.js';
import { advanceLineTool, initialLineToolState } from './line-tool.js';
import { advancePointTool, initialPointToolState } from './point-tool.js';
import { advancePolygonTool, initialPolygonToolState } from './polygon-tool.js';
import { advanceRectangleTool, initialRectangleToolState } from './rectangle-tool.js';
import { advanceRectangleCenterTool, initialRectangleCenterToolState } from './rectangle-center-tool.js';
import { advanceRectangle3PointTool, initialRectangle3PointToolState } from './rectangle-3point-tool.js';
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
    case 'rectangle-center':
      return initialRectangleCenterToolState;
    case 'rectangle-3point':
      return initialRectangle3PointToolState;
    case 'circle':
      return initialCircleToolState;
    case 'circle-3point':
      return initialCircle3PointToolState;
    case 'polygon':
      return initialPolygonToolState;
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
    case 'rectangle-center':
      return advanceRectangleCenterTool(state, event);
    case 'rectangle-3point':
      return advanceRectangle3PointTool(state, event);
    case 'circle':
      return advanceCircleTool(state, event);
    case 'circle-3point':
      return advanceCircle3PointTool(state, event);
    case 'polygon':
      return advancePolygonTool(state, event);
    default: {
      const exhaustive: never = state;
      throw new Error(`Unknown tool state: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export { advanceCircleTool, buildCircleCommit, initialCircleToolState } from './circle-tool.js';
export { advanceCircle3PointTool, buildThreePointCircleCommit, initialCircle3PointToolState } from './circle-3point-tool.js';
export { advanceLineTool, initialLineToolState } from './line-tool.js';
export { advancePointTool, initialPointToolState } from './point-tool.js';
export { advancePolygonTool, buildPolygonCommit, initialPolygonToolState } from './polygon-tool.js';
export { advanceRectangleTool, buildRectangleCommit, initialRectangleToolState } from './rectangle-tool.js';
export { advanceRectangleCenterTool, buildCenterRectangleCommit, initialRectangleCenterToolState } from './rectangle-center-tool.js';
export { advanceRectangle3PointTool, buildThreePointRectangleCommit, initialRectangle3PointToolState } from './rectangle-3point-tool.js';
export type * from './types.js';
