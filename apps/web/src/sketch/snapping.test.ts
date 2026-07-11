import { describe, expect, it } from 'vitest';
import { resolveSnap } from './snapping.js';

const OPTIONS = { gridSize: 10, pointSnapDistance: 3 };

describe('resolveSnap', () => {
  it('snaps a free position to the nearest grid node', () => {
    const snap = resolveSnap({ x: 12, y: -7 }, [], OPTIONS);
    expect(snap).toEqual({ point: { x: 10, y: -10 }, ref: { kind: 'new', x: 10, y: -10 }, kind: 'grid' });
  });

  it('snaps onto an existing point within the snap radius', () => {
    const snap = resolveSnap({ x: 21, y: 0.5 }, [{ id: 'p1', x: 20, y: 0 }], OPTIONS);
    expect(snap.kind).toBe('point');
    expect(snap.ref).toEqual({ kind: 'existing', id: 'p1' });
    expect(snap.point).toEqual({ x: 20, y: 0 });
  });

  it('prefers the closest existing point when several are in range', () => {
    const snap = resolveSnap(
      { x: 10, y: 0 },
      [
        { id: 'far', x: 12, y: 0 },
        { id: 'near', x: 10.5, y: 0 },
      ],
      OPTIONS,
    );
    expect(snap.ref).toEqual({ kind: 'existing', id: 'near' });
  });

  it('falls back to the grid when no existing point is close enough', () => {
    const snap = resolveSnap({ x: 40, y: 40 }, [{ id: 'p1', x: 20, y: 0 }], OPTIONS);
    expect(snap.kind).toBe('grid');
    expect(snap.ref).toEqual({ kind: 'new', x: 40, y: 40 });
  });
});
