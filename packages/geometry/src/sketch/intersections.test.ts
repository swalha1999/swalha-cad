import { describe, expect, it } from 'vitest';
import type { ArcGeometry } from './arc.js';
import { arcEndpoints } from './arc.js';
import type { Vec2 } from './plane.js';
import {
  arcArcIntersections,
  curveSegmentsIntersect,
  findCurveLoopIntersections,
  findLoopSelfIntersections,
  lineArcIntersections,
  lineLineIntersection,
  segmentsIntersect,
  type CurveLoopSegment,
  type LoopSegment,
} from './intersections.js';

/** A counter-clockwise semicircle of radius `r` centred at `c`, from angle 0 to π. */
function upperSemicircle(c: Vec2 = [0, 0], r = 5): ArcGeometry {
  return { center: c, radius: r, startAngle: 0, endAngle: Math.PI, direction: 'ccw' };
}

describe('segmentsIntersect: crossing cases', () => {
  it('detects two segments that cross in an X shape', () => {
    expect(segmentsIntersect([0, 0], [4, 4], [0, 4], [4, 0])).toBe(true);
  });

  it('reports no intersection for parallel segments that never meet', () => {
    expect(segmentsIntersect([0, 0], [4, 0], [0, 1], [4, 1])).toBe(false);
  });

  it('reports no intersection for segments on separate, non-overlapping lines', () => {
    expect(segmentsIntersect([0, 0], [1, 1], [10, 0], [11, 1])).toBe(false);
  });
});

describe('segmentsIntersect: endpoint and touching cases', () => {
  it('detects a shared endpoint as an intersection', () => {
    expect(segmentsIntersect([0, 0], [2, 2], [2, 2], [4, 0])).toBe(true);
  });

  it('detects a T-junction where one endpoint touches the interior of the other segment', () => {
    expect(segmentsIntersect([0, 0], [4, 0], [2, -2], [2, 0])).toBe(true);
  });

  it('detects collinear overlapping segments', () => {
    expect(segmentsIntersect([0, 0], [4, 0], [2, 0], [6, 0])).toBe(true);
  });

  it('reports no intersection for collinear segments that do not overlap', () => {
    expect(segmentsIntersect([0, 0], [2, 0], [3, 0], [5, 0])).toBe(false);
  });
});

describe('lineLineIntersection', () => {
  it('returns the crossing point of two segments in an X', () => {
    const hit = lineLineIntersection([0, 0], [4, 4], [0, 4], [4, 0]);
    expect(hit).not.toBeNull();
    expect(hit![0]).toBeCloseTo(2, 9);
    expect(hit![1]).toBeCloseTo(2, 9);
  });

  it('returns the touch point where one segment ends on the interior of another (T-junction)', () => {
    // Vertical segment through the origin meets a horizontal segment at its endpoint (0,0).
    const hit = lineLineIntersection([0, 5], [0, -3], [0, 0], [10, 0]);
    expect(hit).not.toBeNull();
    expect(hit![0]).toBeCloseTo(0, 9);
    expect(hit![1]).toBeCloseTo(0, 9);
  });

  it('returns null for parallel segments', () => {
    expect(lineLineIntersection([0, 0], [4, 0], [0, 1], [4, 1])).toBeNull();
  });

  it('returns null for collinear segments (no single crossing point)', () => {
    expect(lineLineIntersection([0, 0], [4, 0], [2, 0], [6, 0])).toBeNull();
  });

  it('returns null when the crossing of the infinite lines falls outside a segment', () => {
    // Lines cross at (2,0) but the second segment only spans y in [1,3].
    expect(lineLineIntersection([0, 0], [4, 0], [2, 1], [2, 3])).toBeNull();
  });
});

function segment(lineId: string, a: Vec2, b: Vec2): LoopSegment {
  return { lineId, a, b };
}

describe('findLoopSelfIntersections: quadrilateral loops', () => {
  it('finds no self-intersections for a simple rectangle loop', () => {
    const loop: LoopSegment[] = [
      segment('l0', [0, 0], [4, 0]),
      segment('l1', [4, 0], [4, 2]),
      segment('l2', [4, 2], [0, 2]),
      segment('l3', [0, 2], [0, 0]),
    ];
    expect(findLoopSelfIntersections(loop)).toEqual([]);
  });

  it('finds a self-intersection for a bowtie quadrilateral where opposite edges cross', () => {
    const bowtie: LoopSegment[] = [
      segment('l0', [0, 0], [4, 4]),
      segment('l1', [4, 4], [4, 0]),
      segment('l2', [4, 0], [0, 4]),
      segment('l3', [0, 4], [0, 0]),
    ];
    const result = findLoopSelfIntersections(bowtie);
    expect(result).toEqual([{ lineIdA: 'l0', lineIdB: 'l2' }]);
  });
});

describe('findLoopSelfIntersections: triangle loops', () => {
  it('never flags a triangle, since every pair of edges is adjacent', () => {
    const triangle: LoopSegment[] = [
      segment('l0', [0, 0], [4, 0]),
      segment('l1', [4, 0], [0, 4]),
      segment('l2', [0, 4], [0, 0]),
    ];
    expect(findLoopSelfIntersections(triangle)).toEqual([]);
  });
});

describe('lineArcIntersections', () => {
  const arc = upperSemicircle();

  it('finds two crossings where a horizontal secant cuts the semicircle', () => {
    // y = 3 crosses x^2 + y^2 = 25 at x = ±4, both on the upper (CCW) sweep.
    const hits = lineArcIntersections([-6, 3], [6, 3], arc);
    expect(hits).toHaveLength(2);
    expect(hits.map((p) => Math.round(p[0])).sort((a, b) => a - b)).toEqual([-4, 4]);
  });

  it('reports a single tangent touch at the top of the arc', () => {
    const hits = lineArcIntersections([-6, 5], [6, 5], arc);
    expect(hits).toHaveLength(1);
    expect(hits[0]![0]).toBeCloseTo(0, 6);
    expect(hits[0]![1]).toBeCloseTo(5, 6);
  });

  it('ignores a circle crossing that lies off the arc sweep', () => {
    // x = 0 hits the circle at (0,5) and (0,-5); only the top is on the upper sweep.
    const hits = lineArcIntersections([0, -6], [0, 6], arc);
    expect(hits).toHaveLength(1);
    expect(hits[0]![1]).toBeCloseTo(5, 6);
  });

  it('reports no intersection for a segment that stays outside the circle', () => {
    expect(lineArcIntersections([-6, 8], [6, 8], arc)).toEqual([]);
  });

  it('detects a shared endpoint where a line meets the arc endpoint', () => {
    const { end } = arcEndpoints(arc); // (-5, 0)
    const hits = lineArcIntersections(end, [-5, -4], arc);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});

describe('arcArcIntersections', () => {
  it('finds crossings of two overlapping semicircles on different centres', () => {
    const a = upperSemicircle([0, 0], 5);
    const b = upperSemicircle([6, 0], 5);
    const hits = arcArcIntersections(a, b);
    // Circles centred at (0,0) and (6,0), r=5 cross at x=3, y=±4; only y=+4 is on both upper sweeps.
    expect(hits).toHaveLength(1);
    expect(hits[0]![0]).toBeCloseTo(3, 6);
    expect(hits[0]![1]).toBeCloseTo(4, 6);
  });

  it('reports no intersection for far-apart arcs', () => {
    expect(arcArcIntersections(upperSemicircle([0, 0], 2), upperSemicircle([100, 0], 2))).toEqual([]);
  });

  it('reports no intersection for concentric arcs of different radius', () => {
    expect(arcArcIntersections(upperSemicircle([0, 0], 5), upperSemicircle([0, 0], 3))).toEqual([]);
  });

  it('flags a co-circular overlap where two arcs share part of the same circle', () => {
    const a: ArcGeometry = { center: [0, 0], radius: 5, startAngle: 0, endAngle: Math.PI, direction: 'ccw' };
    const b: ArcGeometry = { center: [0, 0], radius: 5, startAngle: Math.PI / 2, endAngle: (3 * Math.PI) / 2, direction: 'ccw' };
    expect(arcArcIntersections(a, b).length).toBeGreaterThan(0);
  });
});

describe('curveSegmentsIntersect and findCurveLoopIntersections', () => {
  const arc = upperSemicircle();
  const { start, end } = arcEndpoints(arc); // (5,0) and (-5,0)

  it('does not flag a D-shape: a diameter line closed by a semicircle', () => {
    const loop: CurveLoopSegment[] = [
      { id: 'line', kind: 'line', a: end, b: start }, // (-5,0) -> (5,0)
      { id: 'arc', kind: 'arc', a: start, b: end, arc },
    ];
    expect(findCurveLoopIntersections(loop)).toEqual([]);
  });

  it('flags a loop where a non-adjacent line cuts through an arc', () => {
    // A 4-edge loop where edge 0 (a line) crosses non-adjacent edge 2 (an arc).
    const cutter = upperSemicircle([0, 0], 5);
    const loop: CurveLoopSegment[] = [
      { id: 'l0', kind: 'line', a: [-6, 3], b: [6, 3] },
      { id: 'l1', kind: 'line', a: [6, 3], b: [6, -6] },
      { id: 'a2', kind: 'arc', a: [5, 0], b: [-5, 0], arc: cutter },
      { id: 'l3', kind: 'line', a: [-6, -6], b: [-6, 3] },
    ];
    const found = findCurveLoopIntersections(loop);
    expect(found.some((s) => s.lineIdA === 'l0' && s.lineIdB === 'a2')).toBe(true);
  });

  it('dispatches line-line pairs through the segment test', () => {
    expect(
      curveSegmentsIntersect(
        { id: 'a', kind: 'line', a: [0, 0], b: [4, 4] },
        { id: 'b', kind: 'line', a: [0, 4], b: [4, 0] },
      ),
    ).toBe(true);
  });
});
