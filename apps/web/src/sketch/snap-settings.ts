/**
 * Independent, opt-in snapping controls for the free-coordinate sketch canvas.
 *
 * The canvas never quantizes pointer coordinates by default: every toggle here is
 * an independent aid layered on top of continuous floating-point placement, and
 * holding the bypass modifier (Alt/Option) suppresses all of them at once. Grid
 * *display* is a separate visual concern from grid *snapping* — see the store's
 * `gridVisible` flag.
 */

/** One independent snap aid the user can enable or disable. */
export interface SnapSettings {
  /** Snap to the nearest grid node (opt-in; the grid is otherwise only a visual aid). */
  grid: boolean;
  /** Snap onto existing sketch points (line/rectangle corners, chain joints). */
  endpoint: boolean;
  /** Snap onto the midpoint of an existing line segment. */
  midpoint: boolean;
  /** Snap onto the center of an existing circle. */
  center: boolean;
  /** Snap onto the intersection of two existing line segments. */
  intersection: boolean;
  /** Infer alignment with an existing point's horizontal or vertical axis. */
  horizontalVertical: boolean;
  /** Snap onto the sketch origin (0, 0). */
  origin: boolean;
}

/** The name of an individual snap toggle. */
export type SnapTarget = keyof SnapSettings;

/**
 * Sensible defaults: object and inference snaps are on so drawing feels assisted,
 * but grid snapping is off so the default click lands on the exact continuous
 * coordinate under the cursor rather than a quantized grid node.
 */
export const DEFAULT_SNAP_SETTINGS: SnapSettings = {
  grid: false,
  endpoint: true,
  midpoint: true,
  center: true,
  intersection: true,
  horizontalVertical: true,
  origin: true,
};

/** Ordered, labelled snap targets for the settings UI. */
export const SNAP_TARGETS: readonly { key: SnapTarget; label: string }[] = [
  { key: 'endpoint', label: 'Endpoints' },
  { key: 'midpoint', label: 'Midpoints' },
  { key: 'center', label: 'Centers' },
  { key: 'intersection', label: 'Intersections' },
  { key: 'horizontalVertical', label: 'Horizontal / Vertical' },
  { key: 'origin', label: 'Origin' },
  { key: 'grid', label: 'Grid' },
];
