import {
  centerPointArc,
  centerRectangleCorners,
  circumcircle,
  regularPolygonVertices,
  straightSlot,
  tangentArc,
  threePointArc,
  threePointRectangleCorners,
  type ArcGeometry,
} from '@swalha-cad/geometry';
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
  /** In-progress arc previews (arc tools and slot caps); omitted when there are none. */
  arcs?: ArcGeometry[];
}

const EMPTY: PreviewGeometry = { points: [], segments: [], circles: [] };

/** Perpendicular half-width from a slot's centerline to `through`. */
function slotHalfWidth(a: Vec2, b: Vec2, through: Vec2): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  return Math.abs((dx / length) * (through.y - a.y) - (dy / length) * (through.x - a.x));
}

function rectangleSegments(a: Vec2, b: Vec2): PreviewSegment[] {
  const corners: Vec2[] = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
  return corners.map((corner, index) => ({ a: corner, b: corners[(index + 1) % corners.length]! }));
}

/** Closes a list of corners into a preview loop (last corner back to the first). */
function loopSegments(corners: Vec2[]): PreviewSegment[] {
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

    case 'rectangle-center': {
      if (!state.center || !cursor) return EMPTY;
      const corners = centerRectangleCorners([state.center.point.x, state.center.point.y], [cursor.x, cursor.y]);
      const segments = corners ? loopSegments(corners.map(([x, y]) => ({ x, y }))) : [];
      return { points: [state.center.point], segments, circles: [] };
    }

    case 'rectangle-3point': {
      if (!state.start) return EMPTY;
      if (!state.edgeEnd) {
        const segments = cursor ? [{ a: state.start.point, b: cursor }] : [];
        return { points: [state.start.point], segments, circles: [] };
      }
      if (!cursor) return { points: [state.start.point, state.edgeEnd.point], segments: [], circles: [] };
      const corners = threePointRectangleCorners(
        [state.start.point.x, state.start.point.y],
        [state.edgeEnd.point.x, state.edgeEnd.point.y],
        [cursor.x, cursor.y],
      );
      const segments = corners ? loopSegments(corners.map(([x, y]) => ({ x, y }))) : [{ a: state.start.point, b: state.edgeEnd.point }];
      return { points: [state.start.point, state.edgeEnd.point], segments, circles: [] };
    }

    case 'circle-3point': {
      const points = state.points.map((p) => p.point);
      if (state.points.length < 2 || !cursor) return { points, segments: [], circles: [] };
      const [a, b] = state.points;
      const circle = circumcircle([a!.point.x, a!.point.y], [b!.point.x, b!.point.y], [cursor.x, cursor.y]);
      const circles = circle ? [{ center: { x: circle.center[0], y: circle.center[1] }, radius: circle.radius }] : [];
      return { points, segments: [], circles };
    }

    case 'polygon': {
      if (!state.center || !cursor) return EMPTY;
      const vertices = regularPolygonVertices([state.center.point.x, state.center.point.y], [cursor.x, cursor.y], state.sides);
      const segments = vertices ? loopSegments(vertices.map(([x, y]) => ({ x, y }))) : [];
      return { points: [state.center.point], segments, circles: [] };
    }

    case 'arc-center': {
      if (!state.center) return EMPTY;
      if (!state.start) {
        const segments = cursor ? [{ a: state.center.point, b: cursor }] : [];
        return { points: [state.center.point], segments, circles: [] };
      }
      if (!cursor) return { points: [state.center.point, state.start.point], segments: [], circles: [] };
      const arc = centerPointArc(
        [state.center.point.x, state.center.point.y],
        [state.start.point.x, state.start.point.y],
        [cursor.x, cursor.y],
      );
      return { points: [state.center.point, state.start.point], segments: [], circles: [], arcs: arc ? [arc] : [] };
    }

    case 'arc-3point': {
      if (!state.start) return EMPTY;
      if (!state.end) {
        const segments = cursor ? [{ a: state.start.point, b: cursor }] : [];
        return { points: [state.start.point], segments, circles: [] };
      }
      if (!cursor) return { points: [state.start.point, state.end.point], segments: [], circles: [] };
      const arc = threePointArc(
        [state.start.point.x, state.start.point.y],
        [cursor.x, cursor.y],
        [state.end.point.x, state.end.point.y],
      );
      return { points: [state.start.point, state.end.point], segments: [], circles: [], arcs: arc ? [arc] : [] };
    }

    case 'arc-tangent': {
      if (!state.start || !cursor) return state.start ? { points: [state.start.point], segments: [], circles: [] } : EMPTY;
      const arc = state.tangent
        ? tangentArc([state.start.point.x, state.start.point.y], [state.tangent.x, state.tangent.y], [cursor.x, cursor.y])
        : null;
      const segments = arc ? [] : [{ a: state.start.point, b: cursor }];
      return { points: [state.start.point], segments, circles: [], arcs: arc ? [arc] : [] };
    }

    case 'slot': {
      if (!state.centerA) return EMPTY;
      if (!state.centerB) {
        const segments = cursor ? [{ a: state.centerA.point, b: cursor }] : [];
        return { points: [state.centerA.point], segments, circles: [] };
      }
      if (!cursor) return { points: [state.centerA.point, state.centerB.point], segments: [], circles: [] };
      const radius = slotHalfWidth(state.centerA.point, state.centerB.point, cursor);
      const slot = radius === null ? null : straightSlot(
        [state.centerA.point.x, state.centerA.point.y],
        [state.centerB.point.x, state.centerB.point.y],
        radius,
      );
      if (!slot) return { points: [state.centerA.point, state.centerB.point], segments: [], circles: [] };
      const segments = slot.lines.map((line) => ({ a: { x: line.a[0], y: line.a[1] }, b: { x: line.b[0], y: line.b[1] } }));
      return { points: [state.centerA.point, state.centerB.point], segments, circles: [], arcs: [...slot.arcs] };
    }

    default: {
      const exhaustive: never = state;
      throw new Error(`Unknown tool state: ${JSON.stringify(exhaustive)}`);
    }
  }
}
