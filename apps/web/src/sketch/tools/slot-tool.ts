import { straightSlot } from '@swalha-cad/geometry';
import type { SketchCommit, SlotToolState, SnapResult, ToolEvent, ToolResult } from './types.js';

export const initialSlotToolState: SlotToolState = { tool: 'slot', centerA: null, centerB: null, cursor: null };

/** Perpendicular distance from `through` to the slot's centerline (its half-width). */
function slotRadius(centerA: SnapResult, centerB: SnapResult, through: SnapResult): number | null {
  const ax = centerA.point.x;
  const ay = centerA.point.y;
  const dx = centerB.point.x - ax;
  const dy = centerB.point.y - ay;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const ux = dx / length;
  const uy = dy / length;
  const wx = through.point.x - ax;
  const wy = through.point.y - ay;
  return Math.abs(ux * wy - uy * wx);
}

/**
 * Builds a straight-slot commit: two cap-center points, four tangent points, two
 * parallel side lines, and two semicircular caps. `through` sets the slot's width
 * (its perpendicular distance to the centerline). Returns `null` for coincident
 * centers or a zero width so the tool rejects the click without mutating.
 */
export function buildSlotCommit(centerA: SnapResult, centerB: SnapResult, through: SnapResult): SketchCommit | null {
  const radius = slotRadius(centerA, centerB, through);
  if (radius === null) return null;
  const slot = straightSlot([centerA.point.x, centerA.point.y], [centerB.point.x, centerB.point.y], radius);
  if (!slot) return null;
  const { aLeft, aRight, bLeft, bRight } = slot.tangentPoints;
  const [capA, capB] = slot.arcs;
  return {
    // 0 aLeft, 1 bLeft, 2 aRight, 3 bRight, 4 centerA, 5 centerB
    points: [
      { kind: 'new', x: aLeft[0], y: aLeft[1] },
      { kind: 'new', x: bLeft[0], y: bLeft[1] },
      { kind: 'new', x: aRight[0], y: aRight[1] },
      { kind: 'new', x: bRight[0], y: bRight[1] },
      centerA.ref,
      centerB.ref,
    ],
    lines: [
      { start: 0, end: 1 },
      { start: 2, end: 3 },
    ],
    circles: [],
    arcs: [
      { center: 4, radius: capA!.radius, startAngle: capA!.startAngle, endAngle: capA!.endAngle, direction: capA!.direction },
      { center: 5, radius: capB!.radius, startAngle: capB!.startAngle, endAngle: capB!.endAngle, direction: capB!.direction },
    ],
  };
}

/**
 * Straight slot tool: the first two clicks set the cap centers, the third sets the
 * width and commits. A second click coincident with the first center is ignored;
 * a zero-width third click is rejected without mutation. Escape peels back one cap
 * center at a time, then deactivates the tool.
 */
export function advanceSlotTool(state: SlotToolState, event: ToolEvent): ToolResult {
  switch (event.type) {
    case 'move':
      return { state: { ...state, cursor: event.snap.point }, commit: null, exitTool: false };

    case 'click': {
      if (!state.centerA) {
        return { state: { ...state, centerA: event.snap, cursor: event.snap.point }, commit: null, exitTool: false };
      }
      if (!state.centerB) {
        const coincident = event.snap.point.x === state.centerA.point.x && event.snap.point.y === state.centerA.point.y;
        if (coincident) return { state, commit: null, exitTool: false };
        return { state: { ...state, centerB: event.snap, cursor: event.snap.point }, commit: null, exitTool: false };
      }
      const commit = buildSlotCommit(state.centerA, state.centerB, event.snap);
      if (!commit) return { state, commit: null, exitTool: false };
      return { state: { ...state, centerA: null, centerB: null }, commit, exitTool: false };
    }

    case 'finish':
      return { state, commit: null, exitTool: false };

    case 'cancel':
      if (state.centerB) return { state: { ...state, centerB: null }, commit: null, exitTool: false };
      if (state.centerA) return { state: { ...state, centerA: null }, commit: null, exitTool: false };
      return { state, commit: null, exitTool: true };

    default: {
      const exhaustive: never = event;
      throw new Error(`Unknown tool event: ${JSON.stringify(exhaustive)}`);
    }
  }
}
