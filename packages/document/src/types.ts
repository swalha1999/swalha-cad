export type Vec3 = readonly [number, number, number];

export interface Transform {
  translation: Vec3;
  rotationDeg: Vec3;
  scale: Vec3;
}

export type Primitive =
  | { kind: 'box'; width: number; height: number; depth: number }
  | { kind: 'cylinder'; radius: number; height: number; segments: number }
  | { kind: 'lBracket'; width: number; height: number; depth: number; thickness: number };

export interface CadEntity {
  id: string;
  name: string;
  primitive: Primitive;
  transform: Transform;
  visible: boolean;
}

export interface CadDocumentV1 {
  schemaVersion: 1;
  units: 'mm';
  entities: CadEntity[];
}

export type SketchPlane = 'XY' | 'XZ' | 'YZ';

/** Sweep direction of an arc from its start angle to its end angle: counter-clockwise or clockwise. */
export type ArcDirection = 'ccw' | 'cw';

export type SketchEntity =
  | { id: string; kind: 'point'; x: number; y: number; construction: boolean }
  | { id: string; kind: 'line'; startId: string; endId: string; construction: boolean }
  | { id: string; kind: 'circle'; centerId: string; radius: number; construction: boolean }
  | {
      id: string;
      kind: 'arc';
      /** Point entity at the arc's center; endpoints are derived from the center, radius, and angles. */
      centerId: string;
      radius: number;
      /** Plane-local angle (radians) of the start endpoint, measured from the center. */
      startAngle: number;
      /** Plane-local angle (radians) of the end endpoint, measured from the center. */
      endAngle: number;
      direction: ArcDirection;
      construction: boolean;
    };

export type SketchConstraint =
  | { id: string; kind: 'coincident'; pointA: string; pointB: string }
  | { id: string; kind: 'horizontal'; lineId: string }
  | { id: string; kind: 'vertical'; lineId: string }
  | { id: string; kind: 'distance'; pointA: string; pointB: string; value: number }
  | { id: string; kind: 'radius'; circleId: string; value: number }
  | { id: string; kind: 'angle'; lineA: string; lineB: string; valueDeg: number };

/**
 * A stable reference to a planar face of an evaluated solid, used as a sketch's
 * support instead of an origin plane. `bodyId` names the owning evaluated body —
 * an entity id for a primitive or a feature id for a derived solid — and
 * `faceId` is that body's deterministic semantic face id (e.g. `'top'`,
 * `'side:<edgeId>'`, `'+x'`). Neither is a transient Three.js face index; the
 * pair is re-resolved against the evaluated geometry each time the frame is
 * needed, and a reference that no longer resolves is reported explicitly rather
 * than reattached to a different face.
 */
export interface SketchFaceSupport {
  bodyId: string;
  faceId: string;
}

export interface SketchFeature {
  id: string;
  kind: 'sketch';
  name: string;
  /**
   * The origin plane a sketch is drawn on. For a face-supported sketch this is
   * retained as the nearest principal plane (an orientation hint / legacy
   * fallback); the true support frame comes from {@link face}.
   */
  plane: SketchPlane;
  /**
   * When present, the sketch is supported by a planar face of an evaluated solid
   * rather than the origin {@link plane}. Optional so all existing origin-plane
   * sketches (and documents saved before face sketching) are unchanged.
   */
  face?: SketchFaceSupport | undefined;
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  visible: boolean;
}

export interface ExtrudeFeature {
  id: string;
  kind: 'extrude';
  name: string;
  sketchId: string;
  depth: number;
  direction: 'normal' | 'symmetric';
  /**
   * Flips a `normal` sweep to the opposite side of the plane (from `0` to
   * `-depth` instead of `0` to `+depth`). Ignored for a `symmetric` sweep, which
   * already straddles the plane. Optional so V2 documents saved before reverse
   * existed still load; absent is treated as `false`.
   */
  reverse?: boolean | undefined;
  visible: boolean;
}

export type CadFeature = SketchFeature | ExtrudeFeature;

export interface CadDocumentV2 {
  schemaVersion: 2;
  units: 'mm';
  entities: CadEntity[];
  features: CadFeature[];
}
