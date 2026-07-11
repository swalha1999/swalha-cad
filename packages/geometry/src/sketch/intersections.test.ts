import { describe, expect, it } from 'vitest';
import type { Vec2 } from './plane.js';
import { findLoopSelfIntersections, segmentsIntersect, type LoopSegment } from './intersections.js';

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
