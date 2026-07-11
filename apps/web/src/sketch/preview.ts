import type { ToolState, Vec2 } from './tools/types.js';

export interface PreviewSegment {
  a: Vec2;
  b: Vec2;
}

export interface PreviewCircle {
  center: Vec2;
  radius: number;
}

/** Transient geometry shown while a tool step is in progress (never committed). */
export interface PreviewGeometry {
  points: Vec2[];
  segments: PreviewSegment[];
  circles: PreviewCircle[];
}

const EMPTY: PreviewGeometry = { points: [], segments: [], circles: [] };

function rectangleSegments(a: Vec2, b: Vec2): PreviewSegment[] {
  const corners: Vec2[] = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
  return corners.map((corner, index) => ({ a: corner, b: corners[(index + 1) % corners.length]! }));
}

/**
 * Derives the in-progress preview geometry for the active tool given the latest
 * snapped `cursor`. Pure and deterministic so it can be unit-tested apart from
 * SVG rendering; the overlay draws the result in a distinct provisional style.
 */
export function toolPreview(state: ToolState | null, cursor: Vec2 | null): PreviewGeometry {
  if (!state) return EMPTY;

  switch (state.tool) {
    case 'point':
      return EMPTY;

    case 'line': {
      const points = [...state.vertices.map((vertex) => vertex.point)];
      const segments: PreviewSegment[] = [];
      for (let i = 1; i < points.length; i++) {
        segments.push({ a: points[i - 1]!, b: points[i]! });
      }
      const last = points[points.length - 1];
      if (last && cursor) segments.push({ a: last, b: cursor });
      return { points, segments, circles: [] };
    }

    case 'rectangle': {
      if (!state.start || !cursor) return EMPTY;
      return { points: [state.start.point], segments: rectangleSegments(state.start.point, cursor), circles: [] };
    }

    case 'circle': {
      if (!state.center || !cursor) return EMPTY;
      const radius = Math.hypot(cursor.x - state.center.point.x, cursor.y - state.center.point.y);
      return { points: [state.center.point], segments: [], circles: radius > 0 ? [{ center: state.center.point, radius }] : [] };
    }

    default: {
      const exhaustive: never = state;
      throw new Error(`Unknown tool state: ${JSON.stringify(exhaustive)}`);
    }
  }
}
