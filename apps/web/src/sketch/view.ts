/**
 * Fixed view constants shared by the sketch overlay's SVG rendering and the
 * interaction hook's pointer→plane mapping. The overlay uses a symmetric
 * origin-centred SVG viewBox (`SKETCH_VIEW_WIDTH` × `SKETCH_VIEW_HEIGHT` user
 * units), so one sketch millimetre is always {@link PIXELS_PER_UNIT} user units
 * regardless of the element's rendered size — the browser scales the SVG to fit.
 */
export const PIXELS_PER_UNIT = 4;
export const SKETCH_VIEW_WIDTH = 1200;
export const SKETCH_VIEW_HEIGHT = 800;
export const GRID_SIZE = 10;
/** How close (in mm) the cursor must be to an existing point to snap onto it. */
export const POINT_SNAP_DISTANCE = 3;

/** Half-extents of the visible plane region, in millimetres. */
export const SKETCH_HALF_WIDTH = SKETCH_VIEW_WIDTH / 2 / PIXELS_PER_UNIT;
export const SKETCH_HALF_HEIGHT = SKETCH_VIEW_HEIGHT / 2 / PIXELS_PER_UNIT;

/** Maps a plane-local point (mm, y up) to SVG user coordinates (y down, origin centred). */
export function planeToSvg(x: number, y: number): { x: number; y: number } {
  return { x: x * PIXELS_PER_UNIT, y: -y * PIXELS_PER_UNIT };
}
