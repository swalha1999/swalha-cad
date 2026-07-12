import { describe, expect, it } from 'vitest';
import { faceOverlayPositions } from './face-overlay.js';

describe('faceOverlayPositions', () => {
  // A unit quad (two triangles) with a 5th unused vertex, to prove only the face's triangles are emitted.
  const positions = [
    0, 0, 0, // v0
    1, 0, 0, // v1
    1, 1, 0, // v2
    0, 1, 0, // v3
    9, 9, 9, // v4 (unused)
  ];
  const index = [0, 1, 2, 0, 2, 3, 4, 4, 4];

  it('emits a non-indexed 9-float run per triangle in the face', () => {
    const out = faceOverlayPositions(index, positions, [0, 1]);
    expect(out).toHaveLength(18);
    // Triangle 0 → v0,v1,v2
    expect(Array.from(out.slice(0, 9))).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0]);
    // Triangle 1 → v0,v2,v3
    expect(Array.from(out.slice(9, 18))).toEqual([0, 0, 0, 1, 1, 0, 0, 1, 0]);
  });

  it('includes only the requested triangles', () => {
    const out = faceOverlayPositions(index, positions, [0]);
    expect(out).toHaveLength(9);
    expect(Array.from(out)).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0]);
  });

  it('returns an empty buffer for a face with no triangles', () => {
    expect(faceOverlayPositions(index, positions, [])).toHaveLength(0);
  });
});
