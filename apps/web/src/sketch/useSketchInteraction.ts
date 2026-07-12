import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { useCallback, useEffect } from 'react';
import type { SketchEntity } from '@swalha-cad/document';
import { arcEndpoints } from '@swalha-cad/geometry';
import { useCadStoreApi } from '../store/cad-store-context.js';
import { selectActiveSketch } from '../store/cad-store.js';
import type { SnapContext, SnapCircleCenter, SnapLine, SnapPoint } from './snapping.js';
import { resolveSnap } from './snapping.js';
import type { SketchToolKind, SnapResult, Vec2 } from './tools/types.js';
import { GRID_SIZE, PIXELS_PER_UNIT, POINT_SNAP_DISTANCE } from './view.js';

/** Single-key shortcuts that select a drawing tool while the sketch workspace is active. */
const TOOL_SHORTCUTS: Record<string, SketchToolKind> = {
  p: 'point',
  l: 'line',
  r: 'rectangle',
  c: 'circle',
  a: 'arc-3point',
  s: 'slot',
};

/**
 * Maps a client (screen) coordinate to the sketch's plane-local frame using the
 * SVG's own screen CTM, then inverts the y axis (SVG is y-down, the sketch plane
 * is y-up) and rescales by {@link PIXELS_PER_UNIT}. Returns `null` in
 * environments without SVG geometry APIs (e.g. jsdom), where interaction is
 * exercised through the store/tool unit tests and real pointer math is covered
 * by the browser E2E instead.
 */
function clientToPlane(svg: SVGSVGElement, clientX: number, clientY: number): Vec2 | null {
  if (typeof svg.getScreenCTM !== 'function' || typeof svg.createSVGPoint !== 'function') return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const local = point.matrixTransform(ctm.inverse());
  return { x: local.x / PIXELS_PER_UNIT, y: -local.y / PIXELS_PER_UNIT };
}

/** Projects the active sketch's committed geometry into a plane-local snap context. */
function buildSnapContext(entities: readonly SketchEntity[]): SnapContext {
  const points: SnapPoint[] = [];
  const coords = new Map<string, { x: number; y: number }>();
  for (const entity of entities) {
    if (entity.kind === 'point') {
      points.push({ id: entity.id, x: entity.x, y: entity.y });
      coords.set(entity.id, { x: entity.x, y: entity.y });
    }
  }
  const lines: SnapLine[] = [];
  const centers: SnapCircleCenter[] = [];
  const endpoints: { x: number; y: number }[] = [];
  for (const entity of entities) {
    if (entity.kind === 'line') {
      const a = coords.get(entity.startId);
      const b = coords.get(entity.endId);
      if (a && b) lines.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
    } else if (entity.kind === 'circle') {
      const c = coords.get(entity.centerId);
      if (c) centers.push({ id: entity.centerId, x: c.x, y: c.y });
    } else if (entity.kind === 'arc') {
      const c = coords.get(entity.centerId);
      if (c) {
        centers.push({ id: entity.centerId, x: c.x, y: c.y });
        const { start, end } = arcEndpoints({
          center: [c.x, c.y],
          radius: entity.radius,
          startAngle: entity.startAngle,
          endAngle: entity.endAngle,
          direction: entity.direction,
        });
        endpoints.push({ x: start[0], y: start[1] }, { x: end[0], y: end[1] });
      }
    }
  }
  return { points, lines, centers, endpoints };
}

/**
 * Wires DOM pointer/keyboard interaction on the sketch overlay to the store's
 * deterministic tool state machine: pointer moves/clicks resolve against the
 * user's independent snap settings (holding Alt bypasses every snap for exact
 * free placement) and dispatch tool events; double-click/Enter finish a chain and
 * Escape cancels the active step (or a pending dimension). Single-key shortcuts
 * pick a tool (P/L/R/C), start the Distance/Dimension tool (D), or toggle the
 * grid (G). All committing happens inside the store, so every action still flows
 * through the feature-command history.
 */
export function useSketchInteraction(svgRef: RefObject<SVGSVGElement | null>) {
  const storeApi = useCadStoreApi();

  const snapAt = useCallback(
    (clientX: number, clientY: number, bypass: boolean): SnapResult | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const raw = clientToPlane(svg, clientX, clientY);
      if (!raw) return null;
      const state = storeApi.getState();
      const sketch = selectActiveSketch(state);
      const context = buildSnapContext(sketch?.entities ?? []);
      return resolveSnap(raw, context, state.snapSettings, { gridSize: GRID_SIZE, snapDistance: POINT_SNAP_DISTANCE }, bypass);
    },
    [storeApi, svgRef],
  );

  // Raw, un-snapped plane coordinate — the Modify tools keep continuous coordinates
  // and resolve their own on-curve projection, so grid/object snapping never shifts a
  // trim/split pick away from the curve under the cursor.
  const rawAt = useCallback(
    (clientX: number, clientY: number): Vec2 | null => {
      const svg = svgRef.current;
      return svg ? clientToPlane(svg, clientX, clientY) : null;
    },
    [svgRef],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const state = storeApi.getState();
      if (state.sketch?.modify) {
        state.setModifyPoint(rawAt(event.clientX, event.clientY));
        return;
      }
      const snap = snapAt(event.clientX, event.clientY, event.altKey);
      if (snap) state.dispatchSketchEvent({ type: 'move', snap });
    },
    [rawAt, snapAt, storeApi],
  );

  const onClick = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      // Ignore the synthetic click that concludes a double-click sequence.
      if (event.detail > 1) return;
      const state = storeApi.getState();
      // A Modify tool owns clicks: resolve the curve under the cursor and apply the edit.
      if (state.sketch?.modify) {
        const point = rawAt(event.clientX, event.clientY);
        if (point) state.applySketchModify(point);
        return;
      }
      // With no drawing tool active the canvas is in selection mode: a click on
      // empty space (entity hit targets stop propagation) clears the selection.
      if (state.sketch && !state.sketch.tool) {
        state.clearSketchSelection();
        return;
      }
      const snap = snapAt(event.clientX, event.clientY, event.altKey);
      if (snap) state.dispatchSketchEvent({ type: 'click', snap });
    },
    [rawAt, snapAt, storeApi],
  );

  const onDoubleClick = useCallback(() => {
    storeApi.getState().dispatchSketchEvent({ type: 'finish' });
  }, [storeApi]);

  // Escape/Enter/shortcuts are window-level so they work regardless of focus within the workspace.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const state = storeApi.getState();
      if (!state.sketch) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        // A pending dimension owns Escape first (cancel without mutation); otherwise cancel the active tool step.
        if (state.sketch.dimension) {
          state.cancelDimension();
          return;
        }
        // A Modify tool cancels its current preview first, then exits on a second Escape.
        if (state.sketch.modify) {
          if (state.sketch.modify.point) state.setModifyPoint(null);
          else state.setSketchModifyTool(null);
          return;
        }
        state.dispatchSketchEvent({ type: 'cancel' });
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        state.dispatchSketchEvent({ type: 'finish' });
        return;
      }

      // Plain single-key shortcuts only — never hijack modifier combos or typing in a field.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

      const key = event.key.toLowerCase();
      const tool = TOOL_SHORTCUTS[key];
      if (tool) {
        event.preventDefault();
        state.setSketchTool(state.sketch.tool === tool ? null : tool);
      } else if (key === 'd') {
        // Onshape-style Distance/Dimension tool: context-sensitive on the current selection.
        event.preventDefault();
        state.startDimension();
      } else if (key === 't') {
        // Trim modify tool.
        event.preventDefault();
        state.setSketchModifyTool(state.sketch.modify?.tool === 'trim' ? null : 'trim');
      } else if (key === 'k') {
        // Split modify tool.
        event.preventDefault();
        state.setSketchModifyTool(state.sketch.modify?.tool === 'split' ? null : 'split');
      } else if (key === 'g') {
        event.preventDefault();
        state.setGridVisible(!state.gridVisible);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [storeApi]);

  return { onPointerMove, onClick, onDoubleClick };
}
