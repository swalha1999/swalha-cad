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

export type SketchEntity =
  | { id: string; kind: 'point'; x: number; y: number; construction: boolean }
  | { id: string; kind: 'line'; startId: string; endId: string; construction: boolean }
  | { id: string; kind: 'circle'; centerId: string; radius: number; construction: boolean };

export type SketchConstraint =
  | { id: string; kind: 'coincident'; pointA: string; pointB: string }
  | { id: string; kind: 'horizontal'; lineId: string }
  | { id: string; kind: 'vertical'; lineId: string }
  | { id: string; kind: 'distance'; pointA: string; pointB: string; value: number }
  | { id: string; kind: 'radius'; circleId: string; value: number }
  | { id: string; kind: 'angle'; lineA: string; lineB: string; valueDeg: number };

export interface SketchFeature {
  id: string;
  kind: 'sketch';
  name: string;
  plane: SketchPlane;
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
  visible: boolean;
}

export type CadFeature = SketchFeature | ExtrudeFeature;

export interface CadDocumentV2 {
  schemaVersion: 2;
  units: 'mm';
  entities: CadEntity[];
  features: CadFeature[];
}
