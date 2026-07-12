/**
 * Shared types for the deterministic sketch-tool state machines. Each tool is a
 * pure reducer over one of the {@link ToolState} variants and a {@link ToolEvent};
 * it never touches the document directly. A reducer's only side-channel is an
 * optional {@link SketchCommit}, a plane-local description of new geometry that
 * the store resolves into concrete `SketchEntity` ids and applies through the
 * feature-command history (see `store/cad-store.ts`). This keeps every committed
 * action flowing through commands/history and makes the machines unit-testable
 * without any React, Three.js, or document wiring.
 */

/** A 2D coordinate in the sketch's own plane-local frame (millimetres, y up). */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * How a commit's point should be materialised: reuse an existing sketch point
 * (so consecutive segments and shared corners become coincident by construction)
 * or create a fresh point at plane-local coordinates.
 */
export type PointRef = { kind: 'existing'; id: string } | { kind: 'new'; x: number; y: number };

/**
 * Which snap target the cursor resolved to, for the overlay's snap indicator and
 * deterministic priority. `free` means no snap applied — the cursor kept its
 * continuous floating-point plane coordinate (grid quantization is opt-in, never
 * mandatory). Strong object snaps (`endpoint`/`center`/`intersection`/`midpoint`/
 * `origin`) beat inference (`horizontal`/`vertical`) which beats `grid`.
 */
export type SnapKind =
  | 'endpoint'
  | 'midpoint'
  | 'center'
  | 'intersection'
  | 'horizontal'
  | 'vertical'
  | 'origin'
  | 'grid'
  | 'free';

/** The resolved cursor position plus how it should be committed if clicked. */
export interface SnapResult {
  point: Vec2;
  ref: PointRef;
  kind: SnapKind;
}

export type SketchToolKind =
  | 'point'
  | 'line'
  | 'rectangle'
  | 'rectangle-center'
  | 'rectangle-3point'
  | 'circle'
  | 'circle-3point'
  | 'polygon'
  | 'arc-center'
  | 'arc-3point'
  | 'arc-tangent'
  | 'slot';

/** Sweep direction of a committed arc, matching the document `arc` entity. */
export type ArcDirection = 'ccw' | 'cw';

/**
 * A plane-local arc to append: its center is `points[center]` (an index into the
 * commit's points); the endpoints are derived from the radius, angles, and sweep
 * direction, so no endpoint points are created.
 */
export interface SketchCommitArc {
  center: number;
  radius: number;
  startAngle: number;
  endAngle: number;
  direction: ArcDirection;
}

/**
 * A plane-local description of geometry to append to the active sketch. `lines`,
 * `circles`, and `arcs` reference `points` by index; the store dedupes new points
 * that coincide with existing ones and drops zero-length lines. `arcs` is omitted
 * by tools that never create arcs.
 */
export interface SketchCommit {
  points: PointRef[];
  lines: { start: number; end: number }[];
  circles: { center: number; radius: number }[];
  arcs?: SketchCommitArc[];
}

/** Input events for every tool reducer. `finish` is Enter/double-click; `cancel` is Escape. */
export type ToolEvent =
  | { type: 'click'; snap: SnapResult }
  | { type: 'move'; snap: SnapResult }
  | { type: 'finish' }
  | { type: 'cancel' };

export interface PointToolState {
  tool: 'point';
}

export interface LineToolState {
  tool: 'line';
  /** Placed chain vertices; the chain becomes real only when `finish` commits it. */
  vertices: SnapResult[];
  /** Latest snapped cursor, for the rubber-band preview segment. */
  cursor: Vec2 | null;
}

export interface RectangleToolState {
  tool: 'rectangle';
  start: SnapResult | null;
  cursor: Vec2 | null;
}

export interface CircleToolState {
  tool: 'circle';
  center: SnapResult | null;
  cursor: Vec2 | null;
}

/** Center rectangle: first click sets the center, second click an opposite corner. */
export interface RectangleCenterToolState {
  tool: 'rectangle-center';
  center: SnapResult | null;
  cursor: Vec2 | null;
}

/** Three-point rectangle: first two clicks set an edge, the third its perpendicular width. */
export interface Rectangle3PointToolState {
  tool: 'rectangle-3point';
  start: SnapResult | null;
  edgeEnd: SnapResult | null;
  cursor: Vec2 | null;
}

/** Three-point circle: three rim clicks define the circumcircle. */
export interface Circle3PointToolState {
  tool: 'circle-3point';
  points: SnapResult[];
  cursor: Vec2 | null;
}

/** Regular polygon: first click sets the center, second a vertex; `sides` is the loop count. */
export interface PolygonToolState {
  tool: 'polygon';
  sides: number;
  center: SnapResult | null;
  cursor: Vec2 | null;
}

/** Center-point arc: first click sets the center, second the radius/start ray, third the sweep. */
export interface ArcCenterToolState {
  tool: 'arc-center';
  center: SnapResult | null;
  start: SnapResult | null;
  cursor: Vec2 | null;
}

/** Three-point arc: first two clicks set the endpoints, the third a point the arc passes through. */
export interface Arc3PointToolState {
  tool: 'arc-3point';
  start: SnapResult | null;
  end: SnapResult | null;
  cursor: Vec2 | null;
}

/**
 * Tangent arc: continues from a start point (typically a line endpoint) along a
 * seeded `tangent` direction to a second clicked endpoint. The store injects
 * `tangent` from the sketch geometry at the start point; without it the tool
 * cannot build an arc.
 */
export interface ArcTangentToolState {
  tool: 'arc-tangent';
  start: SnapResult | null;
  tangent: Vec2 | null;
  cursor: Vec2 | null;
}

/** Straight slot: first two clicks set the cap centers, the third sets the width (radius). */
export interface SlotToolState {
  tool: 'slot';
  centerA: SnapResult | null;
  centerB: SnapResult | null;
  cursor: Vec2 | null;
}

export type ToolState =
  | PointToolState
  | LineToolState
  | RectangleToolState
  | RectangleCenterToolState
  | Rectangle3PointToolState
  | CircleToolState
  | Circle3PointToolState
  | PolygonToolState
  | ArcCenterToolState
  | Arc3PointToolState
  | ArcTangentToolState
  | SlotToolState;

/** The default number of sides a freshly activated polygon tool starts with. */
export const DEFAULT_POLYGON_SIDES = 6;

/**
 * The result of advancing a tool: the next state, an optional commit to apply
 * through history, and `exitTool` — set when Escape is pressed with nothing
 * pending, asking the store to deactivate the tool (back to plain selection).
 */
export interface ToolResult {
  state: ToolState;
  commit: SketchCommit | null;
  exitTool: boolean;
}
