import { describe, expect, it } from 'vitest';
import { toolPreview } from './preview.js';
import type {
  Arc3PointToolState,
  ArcCenterToolState,
  ArcTangentToolState,
  Circle3PointToolState,
  CircleToolState,
  LineToolState,
  PolygonToolState,
  Rectangle3PointToolState,
  RectangleCenterToolState,
  RectangleToolState,
  SlotToolState,
  SnapResult,
} from './tools/types.js';

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

  it('previews a center rectangle symmetric about the center', () => {
    const state: RectangleCenterToolState = { tool: 'rectangle-center', center: snap(0, 0), cursor: { x: 4, y: 3 } };
    const preview = toolPreview(state, { x: 4, y: 3 });
    expect(preview.segments).toHaveLength(4);
    expect(preview.segments[0]).toEqual({ a: { x: 4, y: 3 }, b: { x: -4, y: 3 } });
  });

  it('omits a degenerate center rectangle preview', () => {
    const state: RectangleCenterToolState = { tool: 'rectangle-center', center: snap(2, 2), cursor: { x: 2, y: 8 } };
    expect(toolPreview(state, { x: 2, y: 8 }).segments).toEqual([]);
  });

  it('previews the first edge of a 3-point rectangle before the width is set', () => {
    const state: Rectangle3PointToolState = { tool: 'rectangle-3point', start: snap(0, 0), edgeEnd: null, cursor: { x: 10, y: 0 } };
    const preview = toolPreview(state, { x: 10, y: 0 });
    expect(preview.segments).toEqual([{ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }]);
  });

  it('previews the full 3-point rectangle once the edge is placed', () => {
    const state: Rectangle3PointToolState = {
      tool: 'rectangle-3point',
      start: snap(0, 0),
      edgeEnd: snap(10, 0),
      cursor: { x: 3, y: 4 },
    };
    const preview = toolPreview(state, { x: 3, y: 4 });
    expect(preview.segments).toHaveLength(4);
    expect(preview.segments[1]).toEqual({ a: { x: 10, y: 0 }, b: { x: 10, y: 4 } });
  });

  it('previews a 3-point circle through two points and the cursor', () => {
    const state: Circle3PointToolState = { tool: 'circle-3point', points: [snap(1, 0), snap(0, 1)], cursor: { x: -1, y: 0 } };
    const preview = toolPreview(state, { x: -1, y: 0 });
    expect(preview.circles).toHaveLength(1);
    expect(preview.circles[0]!.center.x).toBeCloseTo(0, 9);
    expect(preview.circles[0]!.radius).toBeCloseTo(1, 9);
  });

  it('omits a collinear 3-point circle preview', () => {
    const state: Circle3PointToolState = { tool: 'circle-3point', points: [snap(0, 0), snap(1, 1)], cursor: { x: 2, y: 2 } };
    expect(toolPreview(state, { x: 2, y: 2 }).circles).toEqual([]);
  });

  it('previews a regular polygon loop from the center to the cursor vertex', () => {
    const state: PolygonToolState = { tool: 'polygon', sides: 4, center: snap(0, 0), cursor: { x: 1, y: 0 } };
    const preview = toolPreview(state, { x: 1, y: 0 });
    expect(preview.segments).toHaveLength(4);
  });

  it('previews a center-point arc once the start ray is placed', () => {
    const state: ArcCenterToolState = { tool: 'arc-center', center: snap(0, 0), start: snap(2, 0), cursor: { x: 0, y: 3 } };
    const preview = toolPreview(state, { x: 0, y: 3 });
    expect(preview.arcs).toHaveLength(1);
    expect(preview.arcs![0]!.radius).toBeCloseTo(2, 9);
  });

  it('previews a three-point arc through both endpoints and the cursor', () => {
    const state: Arc3PointToolState = { tool: 'arc-3point', start: snap(1, 0), end: snap(-1, 0), cursor: { x: 0, y: 1 } };
    const preview = toolPreview(state, { x: 0, y: 1 });
    expect(preview.arcs).toHaveLength(1);
    expect(preview.arcs![0]!.radius).toBeCloseTo(1, 9);
  });

  it('previews a tangent arc when a tangent is seeded, and a rubber line otherwise', () => {
    const seeded: ArcTangentToolState = { tool: 'arc-tangent', start: snap(0, 0), tangent: { x: 1, y: 0 }, cursor: { x: 0, y: 2 } };
    expect(toolPreview(seeded, { x: 0, y: 2 }).arcs).toHaveLength(1);
    const unseeded: ArcTangentToolState = { tool: 'arc-tangent', start: snap(0, 0), tangent: null, cursor: { x: 0, y: 2 } };
    const preview = toolPreview(unseeded, { x: 0, y: 2 });
    expect(preview.arcs ?? []).toHaveLength(0);
    expect(preview.segments).toHaveLength(1);
  });

  it('previews a slot as two side lines plus two cap arcs', () => {
    const state: SlotToolState = { tool: 'slot', centerA: snap(0, 0), centerB: snap(10, 0), cursor: { x: 5, y: 2 } };
    const preview = toolPreview(state, { x: 5, y: 2 });
    expect(preview.segments).toHaveLength(2);
    expect(preview.arcs).toHaveLength(2);
  });
});
