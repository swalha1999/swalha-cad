import type { SketchConstraint, SketchEntity, SketchFeature } from '@swalha-cad/document';
import { planeToSvg } from './view.js';

interface Glyph {
  id: string;
  kind: SketchConstraint['kind'];
  /** Plane-local anchor position (mm). */
  x: number;
  y: number;
  text: string;
  label: string;
}

/** Compact numeric label (up to two decimals, trailing zeros trimmed). */
function formatValue(value: number): string {
  return Number.parseFloat(value.toFixed(2)).toString();
}

function pointPositions(entities: readonly SketchEntity[]): Map<string, { x: number; y: number }> {
  const map = new Map<string, { x: number; y: number }>();
  for (const entity of entities) {
    if (entity.kind === 'point') map.set(entity.id, { x: entity.x, y: entity.y });
  }
  return map;
}

function lineEndpoints(entities: readonly SketchEntity[]): Map<string, { startId: string; endId: string }> {
  const map = new Map<string, { startId: string; endId: string }>();
  for (const entity of entities) {
    if (entity.kind === 'line') map.set(entity.id, { startId: entity.startId, endId: entity.endId });
  }
  return map;
}

function circleCenters(entities: readonly SketchEntity[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entity of entities) {
    if (entity.kind === 'circle') map.set(entity.id, entity.centerId);
  }
  return map;
}

/** Midpoint of two plane-local points, or `null` if either is missing. */
function midpoint(points: Map<string, { x: number; y: number }>, a: string, b: string): { x: number; y: number } | null {
  const pa = points.get(a);
  const pb = points.get(b);
  if (!pa || !pb) return null;
  return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
}

/** The point id shared by two lines, if they meet at a vertex. */
function sharedVertex(lines: Map<string, { startId: string; endId: string }>, a: string, b: string): string | null {
  const la = lines.get(a);
  const lb = lines.get(b);
  if (!la || !lb) return null;
  const bIds = new Set([lb.startId, lb.endId]);
  if (bIds.has(la.startId)) return la.startId;
  if (bIds.has(la.endId)) return la.endId;
  return null;
}

/** Derives a positioned glyph for each constraint that has a resolvable anchor. */
export function computeGlyphs(sketch: SketchFeature): Glyph[] {
  const points = pointPositions(sketch.entities);
  const lines = lineEndpoints(sketch.entities);
  const centers = circleCenters(sketch.entities);
  const glyphs: Glyph[] = [];

  for (const constraint of sketch.constraints) {
    switch (constraint.kind) {
      case 'coincident': {
        const p = points.get(constraint.pointA) ?? points.get(constraint.pointB);
        if (p) glyphs.push({ id: constraint.id, kind: constraint.kind, x: p.x, y: p.y, text: '◦', label: 'Coincident' });
        break;
      }
      case 'horizontal': {
        const line = lines.get(constraint.lineId);
        const mid = line && midpoint(points, line.startId, line.endId);
        if (mid) glyphs.push({ id: constraint.id, kind: constraint.kind, x: mid.x, y: mid.y, text: 'H', label: 'Horizontal' });
        break;
      }
      case 'vertical': {
        const line = lines.get(constraint.lineId);
        const mid = line && midpoint(points, line.startId, line.endId);
        if (mid) glyphs.push({ id: constraint.id, kind: constraint.kind, x: mid.x, y: mid.y, text: 'V', label: 'Vertical' });
        break;
      }
      case 'distance': {
        const mid = midpoint(points, constraint.pointA, constraint.pointB);
        if (mid) glyphs.push({ id: constraint.id, kind: constraint.kind, x: mid.x, y: mid.y, text: `${formatValue(constraint.value)}`, label: 'Distance' });
        break;
      }
      case 'radius': {
        const centerId = centers.get(constraint.circleId);
        const center = centerId ? points.get(centerId) : undefined;
        if (center) glyphs.push({ id: constraint.id, kind: constraint.kind, x: center.x, y: center.y, text: `R${formatValue(constraint.value)}`, label: 'Radius' });
        break;
      }
      case 'angle': {
        const vertexId = sharedVertex(lines, constraint.lineA, constraint.lineB);
        const vertex = vertexId ? points.get(vertexId) : undefined;
        if (vertex) glyphs.push({ id: constraint.id, kind: constraint.kind, x: vertex.x, y: vertex.y, text: `${formatValue(constraint.valueDeg)}°`, label: 'Angle' });
        break;
      }
    }
  }
  return glyphs;
}

/**
 * Renders the visible constraint glyphs over the sketch: a small labelled badge
 * at each constraint's anchor (H/V for orientation, ◦ for coincidence, a length
 * for distance/radius, a degree value for angle). Dimensional glyphs show their
 * value so the sketch reads like a dimensioned drawing. Purely presentational —
 * it derives everything from the committed sketch feature.
 */
export function ConstraintGlyphs({ sketch }: { sketch: SketchFeature }) {
  const glyphs = computeGlyphs(sketch);
  return (
    <g className="sketch-overlay__glyphs" aria-hidden="true">
      {glyphs.map((glyph) => {
        const p = planeToSvg(glyph.x, glyph.y);
        return (
          <g key={glyph.id} className={`sketch-glyph sketch-glyph--${glyph.kind}`} data-constraint-kind={glyph.kind}>
            <rect x={p.x + 4} y={p.y - 16} width={glyph.text.length * 7 + 8} height={14} rx={3} className="sketch-glyph__badge" />
            <text x={p.x + 8} y={p.y - 5} className="sketch-glyph__text">
              {glyph.text}
            </text>
          </g>
        );
      })}
    </g>
  );
}
