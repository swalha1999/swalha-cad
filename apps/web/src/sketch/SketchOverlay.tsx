import { useRef } from 'react';
import type { SketchEntity } from '@swalha-cad/document';
import { useCadStore } from '../store/cad-store-context.js';
import { selectActiveSketch } from '../store/cad-store.js';
import { toolPreview } from './preview.js';
import type { PreviewGeometry } from './preview.js';
import type { Vec2 } from './tools/types.js';
import { useSketchInteraction } from './useSketchInteraction.js';
import {
  GRID_SIZE,
  PIXELS_PER_UNIT,
  SKETCH_HALF_HEIGHT,
  SKETCH_HALF_WIDTH,
  SKETCH_VIEW_HEIGHT,
  SKETCH_VIEW_WIDTH,
  planeToSvg,
} from './view.js';

const HALF_W = SKETCH_VIEW_WIDTH / 2;
const HALF_H = SKETCH_VIEW_HEIGHT / 2;

/** Grid line multiples (in mm) that fall inside the visible plane region. */
function gridStops(halfExtent: number): number[] {
  const stops: number[] = [];
  for (let value = -Math.floor(halfExtent / GRID_SIZE) * GRID_SIZE; value <= halfExtent; value += GRID_SIZE) {
    stops.push(value);
  }
  return stops;
}

const VERTICAL_STOPS = gridStops(SKETCH_HALF_WIDTH);
const HORIZONTAL_STOPS = gridStops(SKETCH_HALF_HEIGHT);

function pointMap(entities: readonly SketchEntity[]): Map<string, { x: number; y: number }> {
  const map = new Map<string, { x: number; y: number }>();
  for (const entity of entities) {
    if (entity.kind === 'point') map.set(entity.id, { x: entity.x, y: entity.y });
  }
  return map;
}

function Grid() {
  return (
    <g className="sketch-overlay__grid" aria-hidden="true">
      {VERTICAL_STOPS.map((x) => (
        <line key={`v${x}`} x1={x * PIXELS_PER_UNIT} y1={-HALF_H} x2={x * PIXELS_PER_UNIT} y2={HALF_H} className="sketch-overlay__grid-line" />
      ))}
      {HORIZONTAL_STOPS.map((y) => (
        <line key={`h${y}`} x1={-HALF_W} y1={y * PIXELS_PER_UNIT} x2={HALF_W} y2={y * PIXELS_PER_UNIT} className="sketch-overlay__grid-line" />
      ))}
    </g>
  );
}

function Axes() {
  return (
    <g className="sketch-overlay__axes" aria-hidden="true">
      <line x1={-HALF_W} y1={0} x2={HALF_W} y2={0} className="sketch-overlay__axis sketch-overlay__axis--x" />
      <line x1={0} y1={-HALF_H} x2={0} y2={HALF_H} className="sketch-overlay__axis sketch-overlay__axis--y" />
    </g>
  );
}

function Geometry({ entities }: { entities: readonly SketchEntity[] }) {
  const points = pointMap(entities);
  return (
    <g className="sketch-overlay__geometry">
      {entities.map((entity) => {
        const construction = entity.construction ? ' sketch-overlay__edge--construction' : '';
        if (entity.kind === 'line') {
          const a = points.get(entity.startId);
          const b = points.get(entity.endId);
          if (!a || !b) return null;
          const pa = planeToSvg(a.x, a.y);
          const pb = planeToSvg(b.x, b.y);
          return <line key={entity.id} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} className={`sketch-overlay__line${construction}`} />;
        }
        if (entity.kind === 'circle') {
          const c = points.get(entity.centerId);
          if (!c) return null;
          const center = planeToSvg(c.x, c.y);
          return (
            <circle
              key={entity.id}
              cx={center.x}
              cy={center.y}
              r={entity.radius * PIXELS_PER_UNIT}
              className={`sketch-overlay__circle${construction}`}
            />
          );
        }
        const p = planeToSvg(entity.x, entity.y);
        return <circle key={entity.id} cx={p.x} cy={p.y} r={3} className={`sketch-overlay__point${construction}`} />;
      })}
    </g>
  );
}

function Preview({ preview }: { preview: PreviewGeometry }) {
  return (
    <g className="sketch-overlay__preview" aria-hidden="true">
      {preview.segments.map((segment, index) => {
        const a = planeToSvg(segment.a.x, segment.a.y);
        const b = planeToSvg(segment.b.x, segment.b.y);
        return <line key={`s${index}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="sketch-overlay__preview-line" />;
      })}
      {preview.circles.map((circle, index) => {
        const center = planeToSvg(circle.center.x, circle.center.y);
        return (
          <circle key={`c${index}`} cx={center.x} cy={center.y} r={circle.radius * PIXELS_PER_UNIT} className="sketch-overlay__preview-circle" />
        );
      })}
      {preview.points.map((point, index) => {
        const p = planeToSvg(point.x, point.y);
        return <circle key={`p${index}`} cx={p.x} cy={p.y} r={2.5} className="sketch-overlay__preview-point" />;
      })}
    </g>
  );
}

function SnapIndicator({ cursor, kind }: { cursor: Vec2; kind: 'point' | 'grid' }) {
  const p = planeToSvg(cursor.x, cursor.y);
  return (
    <circle
      cx={p.x}
      cy={p.y}
      r={kind === 'point' ? 6 : 4}
      className={`sketch-overlay__snap sketch-overlay__snap--${kind}`}
      aria-hidden="true"
    />
  );
}

/**
 * The focused 2D sketch canvas: a fixed origin-centred SVG that draws the grid,
 * origin axes, committed sketch geometry (construction geometry styled
 * distinctly), the in-progress tool preview, and the snap indicator. Pointer and
 * keyboard interaction is wired by {@link useSketchInteraction}; all committing
 * happens in the store through the feature-command history.
 */
export function SketchOverlay() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const handlers = useSketchInteraction(svgRef);
  const sketch = useCadStore(selectActiveSketch);
  const session = useCadStore((state) => state.sketch);

  const entities = sketch?.entities ?? [];
  const preview = toolPreview(session?.toolState ?? null, session?.cursor ?? null);

  return (
    <svg
      ref={svgRef}
      className="sketch-overlay__svg"
      role="img"
      aria-label="Sketch canvas"
      viewBox={`${-HALF_W} ${-HALF_H} ${SKETCH_VIEW_WIDTH} ${SKETCH_VIEW_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerMove={handlers.onPointerMove}
      onClick={handlers.onClick}
      onDoubleClick={handlers.onDoubleClick}
    >
      <Grid />
      <Axes />
      <Geometry entities={entities} />
      <Preview preview={preview} />
      {session?.cursor && session.cursorSnap ? <SnapIndicator cursor={session.cursor} kind={session.cursorSnap} /> : null}
    </svg>
  );
}
