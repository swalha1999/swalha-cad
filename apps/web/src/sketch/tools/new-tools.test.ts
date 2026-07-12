import { describe, expect, it } from 'vitest';
import { advanceRectangleCenterTool, buildCenterRectangleCommit, initialRectangleCenterToolState } from './rectangle-center-tool.js';
import { advanceRectangle3PointTool, buildThreePointRectangleCommit, initialRectangle3PointToolState } from './rectangle-3point-tool.js';
import { advanceCircle3PointTool, buildThreePointCircleCommit, initialCircle3PointToolState } from './circle-3point-tool.js';
import { advancePolygonTool, buildPolygonCommit, initialPolygonToolState } from './polygon-tool.js';
import { advanceTool, initialToolState } from './index.js';
import type {
  Circle3PointToolState,
  PolygonToolState,
  Rectangle3PointToolState,
  RectangleCenterToolState,
  SnapResult,
} from './types.js';

function freeSnap(x: number, y: number): SnapResult {
  return { point: { x, y }, ref: { kind: 'new', x, y }, kind: 'free' };
}

function existingSnap(id: string, x: number, y: number): SnapResult {
  return { point: { x, y }, ref: { kind: 'existing', id }, kind: 'endpoint' };
}

describe('initialToolState (new tools)', () => {
  it('returns a fresh discriminated state per new tool kind', () => {
    expect(initialToolState('rectangle-center')).toEqual({ tool: 'rectangle-center', center: null, cursor: null });
    expect(initialToolState('rectangle-3point')).toEqual({ tool: 'rectangle-3point', start: null, edgeEnd: null, cursor: null });
    expect(initialToolState('circle-3point')).toEqual({ tool: 'circle-3point', points: [], cursor: null });
    expect(initialToolState('polygon')).toEqual({ tool: 'polygon', sides: 6, center: null, cursor: null });
  });
});

describe('center rectangle tool', () => {
  it('records the center without committing', () => {
    const result = advanceRectangleCenterTool(initialRectangleCenterToolState, { type: 'click', snap: freeSnap(0, 0) });
    expect(result.commit).toBeNull();
    expect((result.state as RectangleCenterToolState).center).not.toBeNull();
  });

  it('commits four corners symmetric about the center on the second click', () => {
    const first = advanceRectangleCenterTool(initialRectangleCenterToolState, { type: 'click', snap: freeSnap(0, 0) });
    const result = advanceRectangleCenterTool(first.state as RectangleCenterToolState, { type: 'click', snap: freeSnap(4, 3) });
    expect(result.commit).toEqual({
      points: [
        { kind: 'new', x: 4, y: 3 },
        { kind: 'new', x: -4, y: 3 },
        { kind: 'new', x: -4, y: -3 },
        { kind: 'new', x: 4, y: -3 },
      ],
      lines: [
        { start: 0, end: 1 },
        { start: 1, end: 2 },
        { start: 2, end: 3 },
        { start: 3, end: 0 },
      ],
      circles: [],
    });
    expect((result.state as RectangleCenterToolState).center).toBeNull();
  });

  it('preserves an existing snapped corner reference', () => {
    const first = advanceRectangleCenterTool(initialRectangleCenterToolState, { type: 'click', snap: freeSnap(0, 0) });
    const result = advanceRectangleCenterTool(first.state as RectangleCenterToolState, { type: 'click', snap: existingSnap('p9', 4, 3) });
    expect(result.commit?.points[0]).toEqual({ kind: 'existing', id: 'p9' });
  });

  it('rejects a degenerate (zero-extent) rectangle without mutation', () => {
    const first = advanceRectangleCenterTool(initialRectangleCenterToolState, { type: 'click', snap: freeSnap(2, 2) });
    const result = advanceRectangleCenterTool(first.state as RectangleCenterToolState, { type: 'click', snap: freeSnap(2, 8) });
    expect(result.commit).toBeNull();
    expect((result.state as RectangleCenterToolState).center).toBeNull();
  });

  it('cancels a pending center, then exits the tool', () => {
    const first = advanceRectangleCenterTool(initialRectangleCenterToolState, { type: 'click', snap: freeSnap(0, 0) });
    const cleared = advanceRectangleCenterTool(first.state as RectangleCenterToolState, { type: 'cancel' });
    expect((cleared.state as RectangleCenterToolState).center).toBeNull();
    expect(cleared.exitTool).toBe(false);
    expect(advanceRectangleCenterTool(cleared.state as RectangleCenterToolState, { type: 'cancel' }).exitTool).toBe(true);
  });

  it('buildCenterRectangleCommit returns null for a degenerate rectangle', () => {
    expect(buildCenterRectangleCommit(freeSnap(0, 0), freeSnap(0, 5))).toBeNull();
  });
});

describe('three-point rectangle tool', () => {
  it('records the first two edge points without committing', () => {
    const first = advanceRectangle3PointTool(initialRectangle3PointToolState, { type: 'click', snap: freeSnap(0, 0) });
    expect(first.commit).toBeNull();
    const second = advanceRectangle3PointTool(first.state as Rectangle3PointToolState, { type: 'click', snap: freeSnap(10, 0) });
    expect(second.commit).toBeNull();
    expect((second.state as Rectangle3PointToolState).edgeEnd).not.toBeNull();
  });

  it('commits a rectangle from edge then perpendicular width on the third click', () => {
    let state = initialRectangle3PointToolState;
    state = advanceRectangle3PointTool(state, { type: 'click', snap: freeSnap(0, 0) }).state as Rectangle3PointToolState;
    state = advanceRectangle3PointTool(state, { type: 'click', snap: freeSnap(10, 0) }).state as Rectangle3PointToolState;
    const result = advanceRectangle3PointTool(state, { type: 'click', snap: freeSnap(3, 4) });
    expect(result.commit?.points).toEqual([
      { kind: 'new', x: 0, y: 0 },
      { kind: 'new', x: 10, y: 0 },
      { kind: 'new', x: 10, y: 4 },
      { kind: 'new', x: 0, y: 4 },
    ]);
    expect(result.commit?.lines).toHaveLength(4);
    expect((result.state as Rectangle3PointToolState).start).toBeNull();
    expect((result.state as Rectangle3PointToolState).edgeEnd).toBeNull();
  });

  it('preserves existing snapped references for the two edge points', () => {
    let state = initialRectangle3PointToolState;
    state = advanceRectangle3PointTool(state, { type: 'click', snap: existingSnap('a', 0, 0) }).state as Rectangle3PointToolState;
    state = advanceRectangle3PointTool(state, { type: 'click', snap: existingSnap('b', 10, 0) }).state as Rectangle3PointToolState;
    const result = advanceRectangle3PointTool(state, { type: 'click', snap: freeSnap(3, 4) });
    expect(result.commit?.points[0]).toEqual({ kind: 'existing', id: 'a' });
    expect(result.commit?.points[1]).toEqual({ kind: 'existing', id: 'b' });
  });

  it('rejects a third point on the edge line (zero width) without mutation', () => {
    let state = initialRectangle3PointToolState;
    state = advanceRectangle3PointTool(state, { type: 'click', snap: freeSnap(0, 0) }).state as Rectangle3PointToolState;
    state = advanceRectangle3PointTool(state, { type: 'click', snap: freeSnap(10, 0) }).state as Rectangle3PointToolState;
    const result = advanceRectangle3PointTool(state, { type: 'click', snap: freeSnap(4, 0) });
    expect(result.commit).toBeNull();
    // The edge stays pending so the user can pick a valid width instead.
    expect((result.state as Rectangle3PointToolState).edgeEnd).not.toBeNull();
  });

  it('cancels the edge stepwise, then exits the tool', () => {
    let state = initialRectangle3PointToolState;
    state = advanceRectangle3PointTool(state, { type: 'click', snap: freeSnap(0, 0) }).state as Rectangle3PointToolState;
    state = advanceRectangle3PointTool(state, { type: 'click', snap: freeSnap(10, 0) }).state as Rectangle3PointToolState;
    // First cancel drops the second edge point.
    const c1 = advanceRectangle3PointTool(state, { type: 'cancel' });
    expect((c1.state as Rectangle3PointToolState).edgeEnd).toBeNull();
    expect((c1.state as Rectangle3PointToolState).start).not.toBeNull();
    expect(c1.exitTool).toBe(false);
    // Second cancel drops the first edge point.
    const c2 = advanceRectangle3PointTool(c1.state as Rectangle3PointToolState, { type: 'cancel' });
    expect((c2.state as Rectangle3PointToolState).start).toBeNull();
    expect(c2.exitTool).toBe(false);
    // Third cancel exits the tool.
    expect(advanceRectangle3PointTool(c2.state as Rectangle3PointToolState, { type: 'cancel' }).exitTool).toBe(true);
  });

  it('buildThreePointRectangleCommit returns null for a zero-length edge', () => {
    expect(buildThreePointRectangleCommit(freeSnap(1, 1), freeSnap(1, 1), freeSnap(5, 5))).toBeNull();
  });
});

describe('three-point circle tool', () => {
  it('accumulates two rim points without committing', () => {
    let state = initialCircle3PointToolState;
    state = advanceCircle3PointTool(state, { type: 'click', snap: freeSnap(1, 0) }).state as Circle3PointToolState;
    const second = advanceCircle3PointTool(state, { type: 'click', snap: freeSnap(0, 1) });
    expect(second.commit).toBeNull();
    expect((second.state as Circle3PointToolState).points).toHaveLength(2);
  });

  it('commits a circle through three points with the correct circumcenter', () => {
    let state = initialCircle3PointToolState;
    for (const snap of [freeSnap(1, 0), freeSnap(0, 1), freeSnap(-1, 0)]) {
      state = advanceCircle3PointTool(state, { type: 'click', snap }).state as Circle3PointToolState;
    }
    // The third click both appends and, having three points, commits.
    state = initialCircle3PointToolState;
    let result = advanceCircle3PointTool(state, { type: 'click', snap: freeSnap(1, 0) });
    result = advanceCircle3PointTool(result.state as Circle3PointToolState, { type: 'click', snap: freeSnap(0, 1) });
    result = advanceCircle3PointTool(result.state as Circle3PointToolState, { type: 'click', snap: freeSnap(-1, 0) });
    expect(result.commit?.points).toEqual([{ kind: 'new', x: 0, y: 0 }]);
    expect(result.commit?.circles).toHaveLength(1);
    expect(result.commit?.circles[0]?.radius).toBeCloseTo(1, 9);
    expect((result.state as Circle3PointToolState).points).toEqual([]);
  });

  it('rejects three collinear points without mutation and keeps the tool ready', () => {
    let result = advanceCircle3PointTool(initialCircle3PointToolState, { type: 'click', snap: freeSnap(0, 0) });
    result = advanceCircle3PointTool(result.state as Circle3PointToolState, { type: 'click', snap: freeSnap(1, 1) });
    result = advanceCircle3PointTool(result.state as Circle3PointToolState, { type: 'click', snap: freeSnap(2, 2) });
    expect(result.commit).toBeNull();
    // Collinear third point is dropped so the user can retry a non-collinear one.
    expect((result.state as Circle3PointToolState).points).toHaveLength(2);
  });

  it('cancels pending rim points, then exits the tool', () => {
    const first = advanceCircle3PointTool(initialCircle3PointToolState, { type: 'click', snap: freeSnap(0, 0) });
    const cleared = advanceCircle3PointTool(first.state as Circle3PointToolState, { type: 'cancel' });
    expect((cleared.state as Circle3PointToolState).points).toEqual([]);
    expect(cleared.exitTool).toBe(false);
    expect(advanceCircle3PointTool(cleared.state as Circle3PointToolState, { type: 'cancel' }).exitTool).toBe(true);
  });

  it('buildThreePointCircleCommit returns null for collinear points', () => {
    expect(buildThreePointCircleCommit(freeSnap(0, 0), freeSnap(1, 1), freeSnap(2, 2))).toBeNull();
  });
});

describe('regular polygon tool', () => {
  it('records the center without committing', () => {
    const result = advancePolygonTool(initialPolygonToolState, { type: 'click', snap: freeSnap(0, 0) });
    expect(result.commit).toBeNull();
    expect((result.state as PolygonToolState).center).not.toBeNull();
  });

  it('commits a closed regular loop of `sides` lines on the vertex click', () => {
    const first = advancePolygonTool({ ...initialPolygonToolState, sides: 4 }, { type: 'click', snap: freeSnap(0, 0) });
    const result = advancePolygonTool(first.state as PolygonToolState, { type: 'click', snap: freeSnap(1, 0) });
    expect(result.commit?.points).toHaveLength(4);
    expect(result.commit?.lines).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 },
      { start: 3, end: 0 },
    ]);
    // The first vertex is exactly the clicked point, preserving its reference.
    expect(result.commit?.points[0]).toEqual({ kind: 'new', x: 1, y: 0 });
    expect((result.state as PolygonToolState).center).toBeNull();
    // Side count persists across the reset for the next polygon.
    expect((result.state as PolygonToolState).sides).toBe(4);
  });

  it('preserves an existing snapped first vertex reference', () => {
    const first = advancePolygonTool({ ...initialPolygonToolState, sides: 5 }, { type: 'click', snap: freeSnap(0, 0) });
    const result = advancePolygonTool(first.state as PolygonToolState, { type: 'click', snap: existingSnap('v', 3, 0) });
    expect(result.commit?.points[0]).toEqual({ kind: 'existing', id: 'v' });
    expect(result.commit?.points).toHaveLength(5);
  });

  it('rejects a zero-radius polygon without mutation', () => {
    const first = advancePolygonTool(initialPolygonToolState, { type: 'click', snap: freeSnap(2, 2) });
    const result = advancePolygonTool(first.state as PolygonToolState, { type: 'click', snap: freeSnap(2, 2) });
    expect(result.commit).toBeNull();
    expect((result.state as PolygonToolState).center).toBeNull();
  });

  it('cancels a pending center, then exits the tool', () => {
    const first = advancePolygonTool(initialPolygonToolState, { type: 'click', snap: freeSnap(0, 0) });
    const cleared = advancePolygonTool(first.state as PolygonToolState, { type: 'cancel' });
    expect((cleared.state as PolygonToolState).center).toBeNull();
    expect(cleared.exitTool).toBe(false);
    expect(advancePolygonTool(cleared.state as PolygonToolState, { type: 'cancel' }).exitTool).toBe(true);
  });

  it('buildPolygonCommit returns null for a zero-radius polygon', () => {
    expect(buildPolygonCommit(freeSnap(3, 3), freeSnap(3, 3), 6)).toBeNull();
  });
});

describe('advanceTool dispatcher (new tools)', () => {
  it('routes events to the reducer matching each new state discriminant', () => {
    expect(advanceTool(initialToolState('rectangle-center'), { type: 'click', snap: freeSnap(1, 2) }).state.tool).toBe(
      'rectangle-center',
    );
    expect(advanceTool(initialToolState('rectangle-3point'), { type: 'click', snap: freeSnap(1, 2) }).state.tool).toBe(
      'rectangle-3point',
    );
    expect(advanceTool(initialToolState('circle-3point'), { type: 'click', snap: freeSnap(1, 2) }).state.tool).toBe('circle-3point');
    expect(advanceTool(initialToolState('polygon'), { type: 'click', snap: freeSnap(1, 2) }).state.tool).toBe('polygon');
  });
});
