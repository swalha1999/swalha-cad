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
