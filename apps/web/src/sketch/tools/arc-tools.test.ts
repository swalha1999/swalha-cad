import { describe, expect, it } from 'vitest';
import { arcEndpoints, type ArcGeometry } from '@swalha-cad/geometry';
import { advanceArcCenterTool, buildCenterArcCommit, initialArcCenterToolState } from './arc-center-tool.js';
import { advanceArc3PointTool, buildThreePointArcCommit, initialArc3PointToolState } from './arc-3point-tool.js';
import { advanceArcTangentTool, buildTangentArcCommit, initialArcTangentToolState } from './arc-tangent-tool.js';
import { advanceSlotTool, buildSlotCommit, initialSlotToolState } from './slot-tool.js';
import { advanceTool, initialToolState } from './index.js';
import type {
  Arc3PointToolState,
  ArcCenterToolState,
  ArcTangentToolState,
  SketchCommitArc,
  SlotToolState,
  SnapResult,
} from './types.js';

function freeSnap(x: number, y: number): SnapResult {
  return { point: { x, y }, ref: { kind: 'new', x, y }, kind: 'free' };
}

function existingSnap(id: string, x: number, y: number): SnapResult {
  return { point: { x, y }, ref: { kind: 'existing', id }, kind: 'endpoint' };
}

/** Rebuilds an ArcGeometry from a committed arc + its resolved center coordinate. */
function toGeometry(arc: SketchCommitArc, center: [number, number]): ArcGeometry {
  return { center, radius: arc.radius, startAngle: arc.startAngle, endAngle: arc.endAngle, direction: arc.direction };
}

describe('initialToolState (arc/slot tools)', () => {
  it('returns a fresh discriminated state per new tool kind', () => {
    expect(initialToolState('arc-center')).toEqual({ tool: 'arc-center', center: null, start: null, cursor: null });
    expect(initialToolState('arc-3point')).toEqual({ tool: 'arc-3point', start: null, end: null, cursor: null });
    expect(initialToolState('arc-tangent')).toEqual({ tool: 'arc-tangent', start: null, tangent: null, cursor: null });
    expect(initialToolState('slot')).toEqual({ tool: 'slot', centerA: null, centerB: null, cursor: null });
  });
});

describe('center-point arc tool', () => {
  it('commits an arc that sweeps from the start ray toward the third click', () => {
    let state: ArcCenterToolState = initialArcCenterToolState;
    state = advanceArcCenterTool(state, { type: 'click', snap: existingSnap('c', 0, 0) }).state as ArcCenterToolState;
    state = advanceArcCenterTool(state, { type: 'click', snap: freeSnap(2, 0) }).state as ArcCenterToolState;
    const result = advanceArcCenterTool(state, { type: 'click', snap: freeSnap(0, 5) });
    const commit = result.commit!;
    expect(commit.points).toEqual([{ kind: 'existing', id: 'c' }]);
    expect(commit.arcs).toHaveLength(1);
    const arc = commit.arcs![0]!;
    expect(arc.center).toBe(0);
    expect(arc.radius).toBeCloseTo(2, 9);
    expect(arc.direction).toBe('ccw');
    const { start, end } = arcEndpoints(toGeometry(arc, [0, 0]));
    expect(start[0]).toBeCloseTo(2, 9);
    expect(end[1]).toBeCloseTo(2, 9);
    expect((result.state as ArcCenterToolState).center).toBeNull();
  });

  it('ignores a start click coincident with the center (zero radius)', () => {
    const state = advanceArcCenterTool(initialArcCenterToolState, { type: 'click', snap: freeSnap(1, 1) }).state as ArcCenterToolState;
    const result = advanceArcCenterTool(state, { type: 'click', snap: freeSnap(1, 1) });
    expect((result.state as ArcCenterToolState).start).toBeNull();
    expect(result.commit).toBeNull();
  });

  it('cancels stepwise (start, then center), then exits the tool', () => {
    let state = advanceArcCenterTool(initialArcCenterToolState, { type: 'click', snap: freeSnap(0, 0) }).state as ArcCenterToolState;
    state = advanceArcCenterTool(state, { type: 'click', snap: freeSnap(2, 0) }).state as ArcCenterToolState;
    const c1 = advanceArcCenterTool(state, { type: 'cancel' });
    expect((c1.state as ArcCenterToolState).start).toBeNull();
    expect((c1.state as ArcCenterToolState).center).not.toBeNull();
    expect(c1.exitTool).toBe(false);
    const c2 = advanceArcCenterTool(c1.state as ArcCenterToolState, { type: 'cancel' });
    expect((c2.state as ArcCenterToolState).center).toBeNull();
    expect(c2.exitTool).toBe(false);
    expect(advanceArcCenterTool(c2.state as ArcCenterToolState, { type: 'cancel' }).exitTool).toBe(true);
  });

  it('buildCenterArcCommit returns null for a zero-radius arc', () => {
    expect(buildCenterArcCommit(freeSnap(0, 0), freeSnap(0, 0), freeSnap(1, 1))).toBeNull();
  });
});

describe('three-point arc tool', () => {
  it('commits an arc through the two endpoints passing through the third click', () => {
    let state: Arc3PointToolState = initialArc3PointToolState;
    state = advanceArc3PointTool(state, { type: 'click', snap: freeSnap(1, 0) }).state as Arc3PointToolState;
    state = advanceArc3PointTool(state, { type: 'click', snap: freeSnap(-1, 0) }).state as Arc3PointToolState;
    const result = advanceArc3PointTool(state, { type: 'click', snap: freeSnap(0, 1) });
    const commit = result.commit!;
    // The circumcenter of (1,0),(0,1),(-1,0) is the origin: a new center point.
    expect(commit.points).toEqual([{ kind: 'new', x: 0, y: 0 }]);
    expect(commit.arcs![0]!.radius).toBeCloseTo(1, 9);
    const { start, end } = arcEndpoints(toGeometry(commit.arcs![0]!, [0, 0]));
    expect(start[0]).toBeCloseTo(1, 9);
    expect(end[0]).toBeCloseTo(-1, 9);
    expect((result.state as Arc3PointToolState).start).toBeNull();
  });

  it('rejects a collinear third point without mutation, keeping the two endpoints', () => {
    let state = advanceArc3PointTool(initialArc3PointToolState, { type: 'click', snap: freeSnap(0, 0) }).state as Arc3PointToolState;
    state = advanceArc3PointTool(state, { type: 'click', snap: freeSnap(2, 2) }).state as Arc3PointToolState;
    const result = advanceArc3PointTool(state, { type: 'click', snap: freeSnap(1, 1) });
    expect(result.commit).toBeNull();
    expect((result.state as Arc3PointToolState).end).not.toBeNull();
  });

  it('cancels stepwise then exits', () => {
    let state = advanceArc3PointTool(initialArc3PointToolState, { type: 'click', snap: freeSnap(0, 0) }).state as Arc3PointToolState;
    state = advanceArc3PointTool(state, { type: 'click', snap: freeSnap(2, 0) }).state as Arc3PointToolState;
    const c1 = advanceArc3PointTool(state, { type: 'cancel' });
    expect((c1.state as Arc3PointToolState).end).toBeNull();
    const c2 = advanceArc3PointTool(c1.state as Arc3PointToolState, { type: 'cancel' });
    expect((c2.state as Arc3PointToolState).start).toBeNull();
    expect(advanceArc3PointTool(c2.state as Arc3PointToolState, { type: 'cancel' }).exitTool).toBe(true);
  });

  it('buildThreePointArcCommit returns null for collinear points', () => {
    expect(buildThreePointArcCommit(freeSnap(0, 0), freeSnap(2, 2), freeSnap(1, 1))).toBeNull();
  });
});

describe('tangent arc tool', () => {
  it('commits an arc tangent to the seeded direction ending at the second click', () => {
    let state = advanceArcTangentTool(initialArcTangentToolState, { type: 'click', snap: existingSnap('p', 0, 0) }).state as ArcTangentToolState;
    // The store injects the tangent; simulate that here.
    state = { ...state, tangent: { x: 1, y: 0 } };
    const result = advanceArcTangentTool(state, { type: 'click', snap: freeSnap(0, 2) });
    const commit = result.commit!;
    expect(commit.points).toEqual([{ kind: 'new', x: 0, y: 1 }]);
    expect(commit.arcs![0]!.radius).toBeCloseTo(1, 9);
    expect((result.state as ArcTangentToolState).start).toBeNull();
    expect((result.state as ArcTangentToolState).tangent).toBeNull();
  });

  it('rejects the second click without a seeded tangent (no mutation, keeps start)', () => {
    const state = advanceArcTangentTool(initialArcTangentToolState, { type: 'click', snap: freeSnap(0, 0) }).state as ArcTangentToolState;
    const result = advanceArcTangentTool(state, { type: 'click', snap: freeSnap(0, 2) });
    expect(result.commit).toBeNull();
    expect((result.state as ArcTangentToolState).start).not.toBeNull();
  });

  it('cancels a pending start (clearing the tangent), then exits', () => {
    let state = advanceArcTangentTool(initialArcTangentToolState, { type: 'click', snap: existingSnap('p', 0, 0) }).state as ArcTangentToolState;
    state = { ...state, tangent: { x: 1, y: 0 } };
    const c1 = advanceArcTangentTool(state, { type: 'cancel' });
    expect((c1.state as ArcTangentToolState).start).toBeNull();
    expect((c1.state as ArcTangentToolState).tangent).toBeNull();
    expect(advanceArcTangentTool(c1.state as ArcTangentToolState, { type: 'cancel' }).exitTool).toBe(true);
  });

  it('buildTangentArcCommit returns null with no tangent or a degenerate target', () => {
    expect(buildTangentArcCommit(freeSnap(0, 0), null, freeSnap(0, 2))).toBeNull();
    expect(buildTangentArcCommit(freeSnap(0, 0), { x: 1, y: 0 }, freeSnap(5, 0))).toBeNull();
  });
});

describe('slot tool', () => {
  it('commits two parallel lines and two arcs from two centers and a width click', () => {
    let state: SlotToolState = initialSlotToolState;
    state = advanceSlotTool(state, { type: 'click', snap: freeSnap(0, 0) }).state as SlotToolState;
    state = advanceSlotTool(state, { type: 'click', snap: freeSnap(10, 0) }).state as SlotToolState;
    const result = advanceSlotTool(state, { type: 'click', snap: freeSnap(5, 2) });
    const commit = result.commit!;
    expect(commit.lines).toHaveLength(2);
    expect(commit.arcs).toHaveLength(2);
    // Six points: four tangent points + the two cap centers.
    expect(commit.points).toHaveLength(6);
    // Cap radius equals the perpendicular distance of the width click to the axis.
    expect(commit.arcs![0]!.radius).toBeCloseTo(2, 9);
    expect((result.state as SlotToolState).centerA).toBeNull();
  });

  it('ignores a second center coincident with the first', () => {
    const state = advanceSlotTool(initialSlotToolState, { type: 'click', snap: freeSnap(1, 1) }).state as SlotToolState;
    const result = advanceSlotTool(state, { type: 'click', snap: freeSnap(1, 1) });
    expect((result.state as SlotToolState).centerB).toBeNull();
  });

  it('rejects a zero-width third click without mutation', () => {
    let state = advanceSlotTool(initialSlotToolState, { type: 'click', snap: freeSnap(0, 0) }).state as SlotToolState;
    state = advanceSlotTool(state, { type: 'click', snap: freeSnap(10, 0) }).state as SlotToolState;
    const result = advanceSlotTool(state, { type: 'click', snap: freeSnap(5, 0) });
    expect(result.commit).toBeNull();
    expect((result.state as SlotToolState).centerB).not.toBeNull();
  });

  it('cancels stepwise then exits', () => {
    let state = advanceSlotTool(initialSlotToolState, { type: 'click', snap: freeSnap(0, 0) }).state as SlotToolState;
    state = advanceSlotTool(state, { type: 'click', snap: freeSnap(10, 0) }).state as SlotToolState;
    const c1 = advanceSlotTool(state, { type: 'cancel' });
    expect((c1.state as SlotToolState).centerB).toBeNull();
    const c2 = advanceSlotTool(c1.state as SlotToolState, { type: 'cancel' });
    expect((c2.state as SlotToolState).centerA).toBeNull();
    expect(advanceSlotTool(c2.state as SlotToolState, { type: 'cancel' }).exitTool).toBe(true);
  });

  it('buildSlotCommit returns null for coincident centers or zero width', () => {
    expect(buildSlotCommit(freeSnap(0, 0), freeSnap(0, 0), freeSnap(1, 1))).toBeNull();
    expect(buildSlotCommit(freeSnap(0, 0), freeSnap(10, 0), freeSnap(5, 0))).toBeNull();
  });
});

describe('advanceTool dispatcher (arc/slot tools)', () => {
  it('routes events to the reducer matching each new state discriminant', () => {
    expect(advanceTool(initialToolState('arc-center'), { type: 'click', snap: freeSnap(1, 2) }).state.tool).toBe('arc-center');
    expect(advanceTool(initialToolState('arc-3point'), { type: 'click', snap: freeSnap(1, 2) }).state.tool).toBe('arc-3point');
    expect(advanceTool(initialToolState('arc-tangent'), { type: 'click', snap: freeSnap(1, 2) }).state.tool).toBe('arc-tangent');
    expect(advanceTool(initialToolState('slot'), { type: 'click', snap: freeSnap(1, 2) }).state.tool).toBe('slot');
  });
});
