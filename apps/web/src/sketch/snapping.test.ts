import { describe, expect, it } from 'vitest';
import { DEFAULT_SNAP_SETTINGS } from './snap-settings.js';
import type { SnapSettings } from './snap-settings.js';
import type { SnapContext } from './snapping.js';
import { resolveSnap } from './snapping.js';

const CONFIG = { gridSize: 10, snapDistance: 3 };
const EMPTY: SnapContext = { points: [], lines: [], centers: [] };

function settings(overrides: Partial<SnapSettings> = {}): SnapSettings {
  return { ...DEFAULT_SNAP_SETTINGS, ...overrides };
}

describe('resolveSnap — continuous free coordinates', () => {
  it('keeps a raw position as an exact continuous coordinate when no snap applies', () => {
    const snap = resolveSnap({ x: 12.37, y: -7.91 }, EMPTY, settings(), CONFIG, false);
    expect(snap.kind).toBe('free');
    expect(snap.point).toEqual({ x: 12.37, y: -7.91 });
    expect(snap.ref).toEqual({ kind: 'new', x: 12.37, y: -7.91 });
  });

  it('does not quantize to the grid by default (grid snapping is off)', () => {
    const snap = resolveSnap({ x: 4.2, y: 4.2 }, EMPTY, settings(), CONFIG, false);
    expect(snap.kind).toBe('free');
    expect(snap.point).toEqual({ x: 4.2, y: 4.2 });
  });
});

describe('resolveSnap — grid target', () => {
  it('snaps to the nearest grid node when grid snapping is enabled', () => {
    const snap = resolveSnap({ x: 12, y: -7 }, EMPTY, settings({ grid: true }), CONFIG, false);
    expect(snap.kind).toBe('grid');
    expect(snap.point).toEqual({ x: 10, y: -10 });
    expect(snap.ref).toEqual({ kind: 'new', x: 10, y: -10 });
  });

  it('leaves coordinates continuous when the grid toggle is off', () => {
    const snap = resolveSnap({ x: 12, y: -7 }, EMPTY, settings({ grid: false }), CONFIG, false);
    expect(snap.kind).toBe('free');
  });
});

describe('resolveSnap — endpoint target', () => {
  it('snaps onto an existing point within the snap distance', () => {
    const context: SnapContext = { points: [{ id: 'p1', x: 20, y: 0 }], lines: [], centers: [] };
    const snap = resolveSnap({ x: 21, y: 0.5 }, context, settings(), CONFIG, false);
    expect(snap.kind).toBe('endpoint');
    expect(snap.ref).toEqual({ kind: 'existing', id: 'p1' });
    expect(snap.point).toEqual({ x: 20, y: 0 });
  });

  it('prefers the nearest existing point when several are in range', () => {
    const context: SnapContext = {
      points: [
        { id: 'far', x: 12, y: 0 },
        { id: 'near', x: 10.5, y: 0 },
      ],
      lines: [],
      centers: [],
    };
    const snap = resolveSnap({ x: 10, y: 0 }, context, settings(), CONFIG, false);
    expect(snap.ref).toEqual({ kind: 'existing', id: 'near' });
  });

  it('does not snap to endpoints when the toggle is off', () => {
    const context: SnapContext = { points: [{ id: 'p1', x: 20, y: 0 }], lines: [], centers: [] };
    const snap = resolveSnap({ x: 20.5, y: 0 }, context, settings({ endpoint: false, horizontalVertical: false }), CONFIG, false);
    expect(snap.kind).toBe('free');
  });
});

describe('resolveSnap — midpoint target', () => {
  const context: SnapContext = { points: [], lines: [{ ax: 0, ay: 0, bx: 20, by: 0 }], centers: [] };

  it('snaps onto a line segment midpoint', () => {
    const snap = resolveSnap({ x: 10.4, y: 0.6 }, context, settings(), CONFIG, false);
    expect(snap.kind).toBe('midpoint');
    expect(snap.point).toEqual({ x: 10, y: 0 });
    expect(snap.ref).toEqual({ kind: 'new', x: 10, y: 0 });
  });

  it('does not snap to midpoints when the toggle is off', () => {
    const snap = resolveSnap({ x: 10.4, y: 0.6 }, context, settings({ midpoint: false }), CONFIG, false);
    expect(snap.kind).toBe('free');
  });
});

describe('resolveSnap — center target', () => {
  const context: SnapContext = { points: [], lines: [], centers: [{ id: 'c1', x: 5, y: 5 }] };

  it('snaps onto a circle center', () => {
    const snap = resolveSnap({ x: 5.5, y: 5.2 }, context, settings({ endpoint: false }), CONFIG, false);
    expect(snap.kind).toBe('center');
    expect(snap.ref).toEqual({ kind: 'existing', id: 'c1' });
    expect(snap.point).toEqual({ x: 5, y: 5 });
  });

  it('does not snap to centers when the toggle is off', () => {
    const snap = resolveSnap({ x: 5.5, y: 5.2 }, context, settings({ center: false, endpoint: false }), CONFIG, false);
    expect(snap.kind).toBe('free');
  });
});

describe('resolveSnap — intersection target', () => {
  // Crossing at (30, 20), well away from the origin so the origin snap can't interfere.
  const context: SnapContext = {
    points: [],
    lines: [
      { ax: 20, ay: 20, bx: 40, by: 20 },
      { ax: 30, ay: 10, bx: 30, by: 30 },
    ],
    centers: [],
  };

  it('snaps onto the intersection of two crossing segments', () => {
    const snap = resolveSnap({ x: 30.5, y: 20.4 }, context, settings({ midpoint: false }), CONFIG, false);
    expect(snap.kind).toBe('intersection');
    expect(snap.point.x).toBeCloseTo(30);
    expect(snap.point.y).toBeCloseTo(20);
  });

  it('does not snap to intersections when the toggle is off', () => {
    const snap = resolveSnap({ x: 30.5, y: 20.4 }, context, settings({ midpoint: false, intersection: false }), CONFIG, false);
    expect(snap.kind).toBe('free');
  });
});

describe('resolveSnap — horizontal/vertical inference', () => {
  const context: SnapContext = { points: [{ id: 'p1', x: 20, y: 40 }], lines: [], centers: [] };

  it('infers alignment with an existing point on the horizontal axis', () => {
    // Far in x (no endpoint snap) but level with p1's y within the snap distance.
    const snap = resolveSnap({ x: 60, y: 41 }, context, settings(), CONFIG, false);
    expect(snap.kind).toBe('horizontal');
    expect(snap.point).toEqual({ x: 60, y: 40 });
  });

  it('infers alignment with an existing point on the vertical axis', () => {
    const snap = resolveSnap({ x: 21, y: 90 }, context, settings(), CONFIG, false);
    expect(snap.kind).toBe('vertical');
    expect(snap.point).toEqual({ x: 20, y: 90 });
  });

  it('does not infer when the toggle is off', () => {
    const snap = resolveSnap({ x: 60, y: 41 }, context, settings({ horizontalVertical: false }), CONFIG, false);
    expect(snap.kind).toBe('free');
  });
});

describe('resolveSnap — origin target', () => {
  it('snaps onto the origin when near it', () => {
    const snap = resolveSnap({ x: 1, y: -0.5 }, EMPTY, settings(), CONFIG, false);
    expect(snap.kind).toBe('origin');
    expect(snap.point).toEqual({ x: 0, y: 0 });
    expect(snap.ref).toEqual({ kind: 'new', x: 0, y: 0 });
  });

  it('does not snap to the origin when the toggle is off', () => {
    const snap = resolveSnap({ x: 1, y: -0.5 }, EMPTY, settings({ origin: false }), CONFIG, false);
    expect(snap.kind).toBe('free');
  });
});

describe('resolveSnap — deterministic nearest-target priority', () => {
  it('prefers a strong object snap over grid even when grid is enabled', () => {
    const context: SnapContext = { points: [{ id: 'p1', x: 1, y: 1 }], lines: [], centers: [] };
    const snap = resolveSnap({ x: 1.4, y: 1.4 }, context, settings({ grid: true }), CONFIG, false);
    expect(snap.kind).toBe('endpoint');
    expect(snap.ref).toEqual({ kind: 'existing', id: 'p1' });
  });

  it('prefers a strong object snap over horizontal/vertical inference', () => {
    const context: SnapContext = { points: [{ id: 'p1', x: 0, y: 0 }], lines: [], centers: [] };
    const snap = resolveSnap({ x: 0.5, y: 0.5 }, context, settings(), CONFIG, false);
    expect(snap.kind).toBe('endpoint');
  });

  it('breaks ties between equidistant strong targets by a fixed priority (endpoint over center)', () => {
    const context: SnapContext = {
      points: [{ id: 'p', x: 0, y: 0 }],
      lines: [],
      centers: [{ id: 'c', x: 0, y: 0 }],
    };
    const snap = resolveSnap({ x: 0.5, y: 0 }, context, settings(), CONFIG, false);
    expect(snap.kind).toBe('endpoint');
  });

  it('is a pure function of its inputs (repeated calls are identical)', () => {
    const context: SnapContext = { points: [{ id: 'p1', x: 20, y: 0 }], lines: [], centers: [] };
    const a = resolveSnap({ x: 21, y: 0.5 }, context, settings(), CONFIG, false);
    const b = resolveSnap({ x: 21, y: 0.5 }, context, settings(), CONFIG, false);
    expect(a).toEqual(b);
  });
});

describe('resolveSnap — modifier bypass', () => {
  it('bypasses every snap and keeps the exact continuous coordinate', () => {
    const context: SnapContext = {
      points: [{ id: 'p1', x: 20, y: 0 }],
      lines: [{ ax: 0, ay: 0, bx: 20, by: 0 }],
      centers: [{ id: 'c1', x: 5, y: 5 }],
    };
    // Every snap enabled, cursor right on top of an existing point, but bypass wins.
    const snap = resolveSnap({ x: 20, y: 0 }, context, settings({ grid: true }), CONFIG, true);
    expect(snap.kind).toBe('free');
    expect(snap.point).toEqual({ x: 20, y: 0 });
    expect(snap.ref).toEqual({ kind: 'new', x: 20, y: 0 });
  });
});
