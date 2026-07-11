import { describe, expect, it } from 'vitest';
import { toolPreview } from './preview.js';
import type { LineToolState, RectangleToolState, CircleToolState, SnapResult } from './tools/types.js';

function snap(x: number, y: number): SnapResult {
  return { point: { x, y }, ref: { kind: 'new', x, y }, kind: 'grid' };
}

describe('toolPreview', () => {
  it('is empty with no active tool', () => {
    expect(toolPreview(null, { x: 0, y: 0 })).toEqual({ points: [], segments: [], circles: [] });
  });

  it('rubber-bands the line tool from the last vertex to the cursor', () => {
    const state: LineToolState = { tool: 'line', vertices: [snap(0, 0), snap(10, 0)], cursor: { x: 10, y: 5 } };
    const preview = toolPreview(state, { x: 10, y: 5 });
    expect(preview.segments).toEqual([
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { a: { x: 10, y: 0 }, b: { x: 10, y: 5 } },
    ]);
  });

  it('previews the four sides of a rectangle from the start corner to the cursor', () => {
    const state: RectangleToolState = { tool: 'rectangle', start: snap(0, 0), cursor: { x: 20, y: 10 } };
    const preview = toolPreview(state, { x: 20, y: 10 });
    expect(preview.segments).toHaveLength(4);
    expect(preview.segments[0]).toEqual({ a: { x: 0, y: 0 }, b: { x: 20, y: 0 } });
  });

  it('previews a circle sized by the center-to-cursor distance', () => {
    const state: CircleToolState = { tool: 'circle', center: snap(0, 0), cursor: { x: 3, y: 4 } };
    const preview = toolPreview(state, { x: 3, y: 4 });
    expect(preview.circles).toEqual([{ center: { x: 0, y: 0 }, radius: 5 }]);
  });

  it('omits a zero-radius circle preview', () => {
    const state: CircleToolState = { tool: 'circle', center: snap(2, 2), cursor: { x: 2, y: 2 } };
    expect(toolPreview(state, { x: 2, y: 2 }).circles).toEqual([]);
  });
});
