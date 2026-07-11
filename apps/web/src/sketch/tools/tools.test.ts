import { describe, expect, it } from 'vitest';
import { advanceCircleTool, initialCircleToolState } from './circle-tool.js';
import { advanceLineTool, initialLineToolState } from './line-tool.js';
import { advancePointTool, initialPointToolState } from './point-tool.js';
import { advanceRectangleTool, initialRectangleToolState } from './rectangle-tool.js';
import { advanceTool, initialToolState } from './index.js';
import type { CircleToolState, LineToolState, RectangleToolState, SnapResult } from './types.js';

function freeSnap(x: number, y: number): SnapResult {
  return { point: { x, y }, ref: { kind: 'new', x, y }, kind: 'grid' };
}

function existingSnap(id: string, x: number, y: number): SnapResult {
  return { point: { x, y }, ref: { kind: 'existing', id }, kind: 'endpoint' };
}

describe('initialToolState', () => {
  it('returns a fresh, discriminated state per tool kind', () => {
    expect(initialToolState('point')).toEqual({ tool: 'point' });
    expect(initialToolState('line')).toEqual({ tool: 'line', vertices: [], cursor: null });
    expect(initialToolState('rectangle')).toEqual({ tool: 'rectangle', start: null, cursor: null });
    expect(initialToolState('circle')).toEqual({ tool: 'circle', center: null, cursor: null });
  });
});

describe('point tool', () => {
  it('commits a single point on click', () => {
    const result = advancePointTool(initialPointToolState, { type: 'click', snap: freeSnap(10, 20) });
    expect(result.commit).toEqual({ points: [{ kind: 'new', x: 10, y: 20 }], lines: [], circles: [] });
    expect(result.exitTool).toBe(false);
  });

  it('does nothing on move or finish', () => {
    expect(advancePointTool(initialPointToolState, { type: 'move', snap: freeSnap(1, 1) }).commit).toBeNull();
    expect(advancePointTool(initialPointToolState, { type: 'finish' }).commit).toBeNull();
  });

  it('exits the tool on cancel because there is no pending step', () => {
    const result = advancePointTool(initialPointToolState, { type: 'cancel' });
    expect(result.commit).toBeNull();
    expect(result.exitTool).toBe(true);
  });
});

describe('line tool', () => {
  it('accumulates vertices without committing until finished', () => {
    let state = initialLineToolState;
    state = advanceLineTool(state, { type: 'click', snap: freeSnap(0, 0) }).state as LineToolState;
    const second = advanceLineTool(state, { type: 'click', snap: freeSnap(10, 0) });
    expect(second.commit).toBeNull();
    expect((second.state as LineToolState).vertices).toHaveLength(2);
  });

  it('commits the whole chain as connected segments on finish', () => {
    let state = initialLineToolState;
    for (const snap of [freeSnap(0, 0), freeSnap(10, 0), freeSnap(10, 10)]) {
      state = advanceLineTool(state, { type: 'click', snap }).state as LineToolState;
    }
    const result = advanceLineTool(state, { type: 'finish' });
    expect(result.commit).toEqual({
      points: [
        { kind: 'new', x: 0, y: 0 },
        { kind: 'new', x: 10, y: 0 },
        { kind: 'new', x: 10, y: 10 },
      ],
      lines: [
        { start: 0, end: 1 },
        { start: 1, end: 2 },
      ],
      circles: [],
    });
    expect((result.state as LineToolState).vertices).toEqual([]);
  });

  it('does not commit a chain with fewer than two vertices on finish', () => {
    const state = advanceLineTool(initialLineToolState, { type: 'click', snap: freeSnap(0, 0) }).state as LineToolState;
    const result = advanceLineTool(state, { type: 'finish' });
    expect(result.commit).toBeNull();
    expect((result.state as LineToolState).vertices).toEqual([]);
  });

  it('tracks the cursor on move for the rubber-band preview', () => {
    const result = advanceLineTool(initialLineToolState, { type: 'move', snap: freeSnap(5, 7) });
    expect((result.state as LineToolState).cursor).toEqual({ x: 5, y: 7 });
  });

  it('cancels an in-progress chain but keeps the tool active', () => {
    const state = advanceLineTool(initialLineToolState, { type: 'click', snap: freeSnap(0, 0) }).state as LineToolState;
    const result = advanceLineTool(state, { type: 'cancel' });
    expect((result.state as LineToolState).vertices).toEqual([]);
    expect(result.exitTool).toBe(false);
  });

  it('exits the tool on cancel when no chain is pending', () => {
    expect(advanceLineTool(initialLineToolState, { type: 'cancel' }).exitTool).toBe(true);
  });
});

describe('rectangle tool', () => {
  it('records the first corner without committing', () => {
    const result = advanceRectangleTool(initialRectangleToolState, { type: 'click', snap: freeSnap(0, 0) });
    expect(result.commit).toBeNull();
    expect((result.state as RectangleToolState).start).not.toBeNull();
  });

  it('commits four points and four lines on the second corner', () => {
    const first = advanceRectangleTool(initialRectangleToolState, { type: 'click', snap: freeSnap(0, 0) });
    const result = advanceRectangleTool(first.state as RectangleToolState, { type: 'click', snap: freeSnap(30, 20) });
    expect(result.commit).toEqual({
      points: [
        { kind: 'new', x: 0, y: 0 },
        { kind: 'new', x: 30, y: 0 },
        { kind: 'new', x: 30, y: 20 },
        { kind: 'new', x: 0, y: 20 },
      ],
      lines: [
        { start: 0, end: 1 },
        { start: 1, end: 2 },
        { start: 2, end: 3 },
        { start: 3, end: 0 },
      ],
      circles: [],
    });
    expect((result.state as RectangleToolState).start).toBeNull();
  });

  it('rejects a degenerate rectangle with a zero side', () => {
    const first = advanceRectangleTool(initialRectangleToolState, { type: 'click', snap: freeSnap(0, 0) });
    const result = advanceRectangleTool(first.state as RectangleToolState, { type: 'click', snap: freeSnap(30, 0) });
    expect(result.commit).toBeNull();
    expect((result.state as RectangleToolState).start).toBeNull();
  });

  it('preserves an existing snapped corner reference in the commit', () => {
    const first = advanceRectangleTool(initialRectangleToolState, { type: 'click', snap: existingSnap('p1', 0, 0) });
    const result = advanceRectangleTool(first.state as RectangleToolState, { type: 'click', snap: freeSnap(30, 20) });
    expect(result.commit?.points[0]).toEqual({ kind: 'existing', id: 'p1' });
  });

  it('cancels a pending corner, then exits the tool on a second cancel', () => {
    const first = advanceRectangleTool(initialRectangleToolState, { type: 'click', snap: freeSnap(0, 0) });
    const cleared = advanceRectangleTool(first.state as RectangleToolState, { type: 'cancel' });
    expect((cleared.state as RectangleToolState).start).toBeNull();
    expect(cleared.exitTool).toBe(false);
    expect(advanceRectangleTool(cleared.state as RectangleToolState, { type: 'cancel' }).exitTool).toBe(true);
  });
});

describe('circle tool', () => {
  it('records the center without committing', () => {
    const result = advanceCircleTool(initialCircleToolState, { type: 'click', snap: freeSnap(5, 5) });
    expect(result.commit).toBeNull();
    expect((result.state as CircleToolState).center).not.toBeNull();
  });

  it('commits a circle whose radius is the center-to-rim distance', () => {
    const first = advanceCircleTool(initialCircleToolState, { type: 'click', snap: freeSnap(0, 0) });
    const result = advanceCircleTool(first.state as CircleToolState, { type: 'click', snap: freeSnap(3, 4) });
    expect(result.commit).toEqual({
      points: [{ kind: 'new', x: 0, y: 0 }],
      lines: [],
      circles: [{ center: 0, radius: 5 }],
    });
    expect((result.state as CircleToolState).center).toBeNull();
  });

  it('rejects a zero-radius circle', () => {
    const first = advanceCircleTool(initialCircleToolState, { type: 'click', snap: freeSnap(2, 2) });
    const result = advanceCircleTool(first.state as CircleToolState, { type: 'click', snap: freeSnap(2, 2) });
    expect(result.commit).toBeNull();
    expect((result.state as CircleToolState).center).toBeNull();
  });

  it('cancels a pending center, then exits the tool on a second cancel', () => {
    const first = advanceCircleTool(initialCircleToolState, { type: 'click', snap: freeSnap(0, 0) });
    const cleared = advanceCircleTool(first.state as CircleToolState, { type: 'cancel' });
    expect((cleared.state as CircleToolState).center).toBeNull();
    expect(advanceCircleTool(cleared.state as CircleToolState, { type: 'cancel' }).exitTool).toBe(true);
  });
});

describe('advanceTool dispatcher', () => {
  it('routes an event to the reducer matching the state discriminant', () => {
    const result = advanceTool(initialToolState('rectangle'), { type: 'click', snap: freeSnap(1, 2) });
    expect(result.state.tool).toBe('rectangle');
    expect((result.state as RectangleToolState).start).not.toBeNull();
  });
});
