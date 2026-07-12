import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useRef } from 'react';
import type { SketchEntity } from '@swalha-cad/document';
import type { ArcGeometry, SolveStatus } from '@swalha-cad/geometry';
import { sampleArc } from '@swalha-cad/geometry';
import { useCadStore } from '../store/cad-store-context.js';
import { selectActiveSketch } from '../store/cad-store.js';
import { ConstraintGlyphs } from './ConstraintGlyphs.js';
import { dimensionAnnotation } from './dimension.js';
import type { DimensionAnnotation } from './dimension.js';
import { DimensionPrompt } from './DimensionPrompt.js';
import { toolPreview } from './preview.js';
import type { PreviewGeometry } from './preview.js';
import type { SnapKind, Vec2 } from './tools/types.js';
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

/** How many line segments approximate one arc when drawing its SVG polyline. */
const ARC_SAMPLES = 48;

/** An SVG polyline `d` string tracing an arc, sampled deterministically in plane space. */
function arcPathD(arc: ArcGeometry): string {
  return sampleArc(arc, ARC_SAMPLES)
    .map(([x, y], index) => {
      const p = planeToSvg(x, y);
      return `${index === 0 ? 'M' : 'L'}${p.x} ${p.y}`;
    })
    .join(' ');
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

interface GeometryProps {
  entities: readonly SketchEntity[];
  selection: ReadonlySet<string>;
  status: SolveStatus;
  selectable: boolean;
  onSelect: (id: string) => void;
}

/**
 * The committed sketch geometry. The group carries the solve status so CSS can
 * apply the blue/dark/red convention; each entity is coloured by construction
 * state and highlighted when selected. When `selectable` (no drawing tool
 * active) each entity is a keyboard-focusable target with a wide invisible hit
 * area, so clicking or pressing Enter/Space toggles it in the constraint
 * selection.
 */
function Geometry({ entities, selection, status, selectable, onSelect }: GeometryProps) {
  const points = pointMap(entities);

  const hitProps = (id: string) =>
    selectable
      ? {
          tabIndex: 0,
          role: 'button' as const,
          'aria-pressed': selection.has(id),
          'aria-label': `Sketch ${entities.find((entity) => entity.id === id)?.kind ?? 'entity'}`,
          onClick: (event: ReactMouseEvent) => {
            event.stopPropagation();
            onSelect(id);
          },
          onKeyDown: (event: ReactKeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              onSelect(id);
            }
          },
        }
      : {};

  return (
    <g className={`sketch-overlay__geometry sketch-overlay__geometry--${status}`} data-solve-status={status}>
      {entities.map((entity) => {
        const construction = entity.construction ? ' sketch-overlay__edge--construction' : '';
        const selected = selection.has(entity.id) ? ' sketch-overlay__selected' : '';
        if (entity.kind === 'line') {
          const a = points.get(entity.startId);
          const b = points.get(entity.endId);
          if (!a || !b) return null;
          const pa = planeToSvg(a.x, a.y);
          const pb = planeToSvg(b.x, b.y);
          return (
            <g key={entity.id} className="sketch-overlay__selectable" data-entity-id={entity.id} data-entity-kind="line">
              <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} className={`sketch-overlay__line${construction}${selected}`} />
              {selectable ? <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} className="sketch-overlay__hit" {...hitProps(entity.id)} /> : null}
            </g>
          );
        }
        if (entity.kind === 'circle') {
          const c = points.get(entity.centerId);
          if (!c) return null;
          const center = planeToSvg(c.x, c.y);
          const r = entity.radius * PIXELS_PER_UNIT;
          return (
            <g key={entity.id} className="sketch-overlay__selectable" data-entity-id={entity.id} data-entity-kind="circle">
              <circle cx={center.x} cy={center.y} r={r} className={`sketch-overlay__circle${construction}${selected}`} />
              {selectable ? <circle cx={center.x} cy={center.y} r={r} className="sketch-overlay__hit sketch-overlay__hit--circle" {...hitProps(entity.id)} /> : null}
            </g>
          );
        }
        if (entity.kind === 'arc') {
          const c = points.get(entity.centerId);
          if (!c) return null;
          const d = arcPathD({
            center: [c.x, c.y],
            radius: entity.radius,
            startAngle: entity.startAngle,
            endAngle: entity.endAngle,
            direction: entity.direction,
          });
          return (
            <g key={entity.id} className="sketch-overlay__selectable" data-entity-id={entity.id} data-entity-kind="arc">
              <path d={d} fill="none" className={`sketch-overlay__arc${construction}${selected}`} />
              {selectable ? <path d={d} fill="none" className="sketch-overlay__hit sketch-overlay__hit--arc" {...hitProps(entity.id)} /> : null}
            </g>
          );
        }
        const p = planeToSvg(entity.x, entity.y);
        return (
          <g key={entity.id} className="sketch-overlay__selectable" data-entity-id={entity.id} data-entity-kind="point">
            <circle cx={p.x} cy={p.y} r={3} className={`sketch-overlay__point${construction}${selected}`} />
            {selectable ? <circle cx={p.x} cy={p.y} r={7} className="sketch-overlay__hit sketch-overlay__hit--point" {...hitProps(entity.id)} /> : null}
          </g>
        );
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
      {(preview.arcs ?? []).map((arc, index) => (
        <path key={`a${index}`} d={arcPathD(arc)} fill="none" className="sketch-overlay__preview-arc" />
      ))}
      {preview.points.map((point, index) => {
        const p = planeToSvg(point.x, point.y);
        return <circle key={`p${index}`} cx={p.x} cy={p.y} r={2.5} className="sketch-overlay__preview-point" />;
      })}
    </g>
  );
}

/** How far (mm) the dimension line is offset from the measured segment, so witness lines are legible. */
const DIMENSION_OFFSET_MM = 10;

/**
 * The live dimension annotation drawn while the Distance tool awaits a value: a
 * witness line from each measured point out to an offset dimension line, plus the
 * inline numeric editor anchored at its midpoint (via a `foreignObject` so it
 * tracks the annotation in sketch space). Purely a preview — nothing is committed
 * until the editor's value is entered.
 */
function DimensionOverlay({ annotation, measured }: { annotation: DimensionAnnotation; measured: number }) {
  const a = planeToSvg(annotation.a.x, annotation.a.y);
  const b = planeToSvg(annotation.b.x, annotation.b.y);
  const aOff = planeToSvg(annotation.aOff.x, annotation.aOff.y);
  const bOff = planeToSvg(annotation.bOff.x, annotation.bOff.y);
  const mid = planeToSvg(annotation.mid.x, annotation.mid.y);
  const width = 132;
  const height = 64;
  return (
    <g className="sketch-overlay__dimension" data-testid="dimension-annotation">
      <line x1={a.x} y1={a.y} x2={aOff.x} y2={aOff.y} className="sketch-overlay__dimension-witness" aria-hidden="true" />
      <line x1={b.x} y1={b.y} x2={bOff.x} y2={bOff.y} className="sketch-overlay__dimension-witness" aria-hidden="true" />
      <line x1={aOff.x} y1={aOff.y} x2={bOff.x} y2={bOff.y} className="sketch-overlay__dimension-line" aria-hidden="true" />
      <foreignObject x={mid.x + 8} y={mid.y - height / 2} width={width} height={height} className="sketch-overlay__dimension-editor">
        <DimensionPrompt measured={measured} />
      </foreignObject>
    </g>
  );
}

/** Strong object snaps get a larger ring; grid/free/inference a smaller one. */
const STRONG_SNAP_KINDS = new Set<SnapKind>(['endpoint', 'center', 'intersection', 'midpoint', 'origin']);

function SnapIndicator({ cursor, kind }: { cursor: Vec2; kind: SnapKind }) {
  const p = planeToSvg(cursor.x, cursor.y);
  return (
    <circle
      cx={p.x}
      cy={p.y}
      r={STRONG_SNAP_KINDS.has(kind) ? 6 : 4}
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
  const selection = useCadStore((state) => state.sketchSelection);
  const solve = useCadStore((state) => state.sketchSolve);
  const gridVisible = useCadStore((state) => state.gridVisible);
  const toggleSelection = useCadStore((state) => state.toggleSketchEntitySelection);
  const dimensionPick = useCadStore((state) => state.dimensionPick);

  const entities = sketch?.entities ?? [];
  const preview = toolPreview(session?.toolState ?? null, session?.cursor ?? null);
  const selectable = !session?.tool;
  const status = solve?.status ?? 'under-constrained';
  const selectionSet = new Set(selection);
  const dimension = session?.dimension ?? null;
  // While the Distance tool is picking geometry, entity clicks feed the dimension; otherwise they toggle selection.
  const onEntityClick = dimension?.phase === 'picking' ? dimensionPick : toggleSelection;
  const annotation =
    sketch && dimension?.phase === 'awaiting' ? dimensionAnnotation(sketch, dimension, DIMENSION_OFFSET_MM) : null;

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
      {gridVisible ? <Grid /> : null}
      <Axes />
      <Geometry entities={entities} selection={selectionSet} status={status} selectable={selectable} onSelect={onEntityClick} />
      {sketch ? <ConstraintGlyphs sketch={sketch} /> : null}
      <Preview preview={preview} />
      {annotation && dimension?.phase === 'awaiting' ? <DimensionOverlay annotation={annotation} measured={dimension.measured} /> : null}
      {session?.cursor && session.cursorSnap ? <SnapIndicator cursor={session.cursor} kind={session.cursorSnap} /> : null}
    </svg>
  );
}
