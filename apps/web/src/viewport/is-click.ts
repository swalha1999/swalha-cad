export interface PointerPoint {
  x: number;
  y: number;
}

const DEFAULT_THRESHOLD_PX = 4;

/**
 * Distinguishes a click (select/deselect) from an orbit drag: OrbitControls
 * consumes the same pointerdown/pointerup pair, so intent is decided by how
 * far the pointer travelled rather than by event type.
 */
export function isClick(start: PointerPoint, end: PointerPoint, thresholdPx = DEFAULT_THRESHOLD_PX): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return Math.hypot(dx, dy) <= thresholdPx;
}
