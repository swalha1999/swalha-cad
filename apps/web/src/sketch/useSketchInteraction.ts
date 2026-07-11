import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { useCallback, useEffect } from 'react';
import { useCadStoreApi } from '../store/cad-store-context.js';
import { selectActiveSketch } from '../store/cad-store.js';
import type { ExistingPoint } from './snapping.js';
import { resolveSnap } from './snapping.js';
import type { SnapResult, Vec2 } from './tools/types.js';
import { GRID_SIZE, PIXELS_PER_UNIT, POINT_SNAP_DISTANCE } from './view.js';

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

/**
 * Wires DOM pointer/keyboard interaction on the sketch overlay to the store's
 * deterministic tool state machine: pointer moves/clicks snap against existing
 * geometry and dispatch tool events, double-click/Enter finish a chain, and
 * Escape cancels the active step. All committing happens inside the store, so
 * every action still flows through the feature-command history.
 */
export function useSketchInteraction(svgRef: RefObject<SVGSVGElement | null>) {
  const storeApi = useCadStoreApi();

  const snapAt = useCallback(
    (clientX: number, clientY: number): SnapResult | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const raw = clientToPlane(svg, clientX, clientY);
      if (!raw) return null;
      const sketch = selectActiveSketch(storeApi.getState());
      const points: ExistingPoint[] = (sketch?.entities ?? [])
        .filter((entity) => entity.kind === 'point')
        .map((entity) => ({ id: entity.id, x: entity.x, y: entity.y }));
      return resolveSnap(raw, points, { gridSize: GRID_SIZE, pointSnapDistance: POINT_SNAP_DISTANCE });
    },
    [storeApi, svgRef],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const snap = snapAt(event.clientX, event.clientY);
      if (snap) storeApi.getState().dispatchSketchEvent({ type: 'move', snap });
    },
    [snapAt, storeApi],
  );

  const onClick = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      // Ignore the synthetic click that concludes a double-click sequence.
      if (event.detail > 1) return;
      const state = storeApi.getState();
      // With no drawing tool active the canvas is in selection mode: a click on
      // empty space (entity hit targets stop propagation) clears the selection.
      if (state.sketch && !state.sketch.tool) {
        state.clearSketchSelection();
        return;
      }
      const snap = snapAt(event.clientX, event.clientY);
      if (snap) state.dispatchSketchEvent({ type: 'click', snap });
    },
    [snapAt, storeApi],
  );

  const onDoubleClick = useCallback(() => {
    storeApi.getState().dispatchSketchEvent({ type: 'finish' });
  }, [storeApi]);

  // Escape/Enter are window-level so they work regardless of focus within the workspace.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (!storeApi.getState().sketch) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        storeApi.getState().dispatchSketchEvent({ type: 'cancel' });
      } else if (event.key === 'Enter') {
        event.preventDefault();
        storeApi.getState().dispatchSketchEvent({ type: 'finish' });
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [storeApi]);

  return { onPointerMove, onClick, onDoubleClick };
}
