import { z } from 'zod';
import { migrateToV2 } from './migrate.js';
import type { CadDocumentV2 } from './types.js';

const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

const transformSchema = z.object({
  translation: vec3Schema,
  rotationDeg: vec3Schema,
  scale: vec3Schema,
});

const positive = z.number().positive();
const positiveFinite = z.number().finite().positive();

const boxPrimitiveSchema = z.object({
  kind: z.literal('box'),
  width: positive,
  height: positive,
  depth: positive,
});

const cylinderPrimitiveSchema = z.object({
  kind: z.literal('cylinder'),
  radius: positive,
  height: positive,
  segments: z.number().int().min(3),
});

const lBracketPrimitiveSchema = z
  .object({
    kind: z.literal('lBracket'),
    width: positive,
    height: positive,
    depth: positive,
    thickness: positive,
  })
  .refine((primitive) => primitive.thickness < primitive.width && primitive.thickness < primitive.height, {
    message: 'thickness must be strictly less than width and height',
    path: ['thickness'],
  });

const primitiveSchema = z.discriminatedUnion('kind', [
  boxPrimitiveSchema,
  cylinderPrimitiveSchema,
  lBracketPrimitiveSchema,
]);

export const cadEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  primitive: primitiveSchema,
  transform: transformSchema,
  visible: z.boolean(),
});

const cadDocumentV1Schema = z.object({
  schemaVersion: z.literal(1),
  units: z.literal('mm'),
  entities: z.array(cadEntitySchema),
});

const sketchPlaneSchema = z.enum(['XY', 'XZ', 'YZ']);

const pointEntitySchema = z
  .object({
    id: z.string(),
    kind: z.literal('point'),
    x: z.number().finite(),
    y: z.number().finite(),
    construction: z.boolean(),
  })
  .strict();

const lineEntitySchema = z
  .object({
    id: z.string(),
    kind: z.literal('line'),
    startId: z.string(),
    endId: z.string(),
    construction: z.boolean(),
  })
  .strict();

const circleEntitySchema = z
  .object({
    id: z.string(),
    kind: z.literal('circle'),
    centerId: z.string(),
    radius: positiveFinite,
    construction: z.boolean(),
  })
  .strict();

const arcEntitySchema = z
  .object({
    id: z.string(),
    kind: z.literal('arc'),
    centerId: z.string(),
    radius: positiveFinite,
    startAngle: z.number().finite(),
    endAngle: z.number().finite(),
    direction: z.enum(['ccw', 'cw']),
    construction: z.boolean(),
  })
  .strict();

export const sketchEntitySchema = z.discriminatedUnion('kind', [
  pointEntitySchema,
  lineEntitySchema,
  circleEntitySchema,
  arcEntitySchema,
]);

const coincidentConstraintSchema = z
  .object({ id: z.string(), kind: z.literal('coincident'), pointA: z.string(), pointB: z.string() })
  .strict();

const horizontalConstraintSchema = z
  .object({ id: z.string(), kind: z.literal('horizontal'), lineId: z.string() })
  .strict();

const verticalConstraintSchema = z
  .object({ id: z.string(), kind: z.literal('vertical'), lineId: z.string() })
  .strict();

const distanceConstraintSchema = z
  .object({
    id: z.string(),
    kind: z.literal('distance'),
    pointA: z.string(),
    pointB: z.string(),
    value: positiveFinite,
  })
  .strict();

const radiusConstraintSchema = z
  .object({ id: z.string(), kind: z.literal('radius'), circleId: z.string(), value: positiveFinite })
  .strict();

const angleConstraintSchema = z
  .object({
    id: z.string(),
    kind: z.literal('angle'),
    lineA: z.string(),
    lineB: z.string(),
    valueDeg: z.number().finite().gt(0).lt(180),
  })
  .strict();

export const sketchConstraintSchema = z.discriminatedUnion('kind', [
  coincidentConstraintSchema,
  horizontalConstraintSchema,
  verticalConstraintSchema,
  distanceConstraintSchema,
  radiusConstraintSchema,
  angleConstraintSchema,
]);

/** Plain (unrefined) shape so it can serve as a `z.discriminatedUnion` member; cross-reference checks live in `validateSketchReferences`. */
export const sketchFeatureSchema = z
  .object({
    id: z.string(),
    kind: z.literal('sketch'),
    name: z.string(),
    plane: sketchPlaneSchema,
    entities: z.array(sketchEntitySchema),
    constraints: z.array(sketchConstraintSchema),
    visible: z.boolean(),
  })
  .strict();

export const extrudeFeatureSchema = z
  .object({
    id: z.string(),
    kind: z.literal('extrude'),
    name: z.string(),
    sketchId: z.string(),
    depth: positiveFinite,
    direction: z.enum(['normal', 'symmetric']),
    reverse: z.boolean().optional(),
    visible: z.boolean(),
  })
  .strict();

type SketchFeatureShape = z.infer<typeof sketchFeatureSchema>;

/** Validates duplicate/dangling entity and constraint references within a single sketch feature. */
function validateSketchReferences(sketch: SketchFeatureShape, ctx: z.RefinementCtx, path: (string | number)[]): void {
  const seenEntityIds = new Set<string>();
  const pointIds = new Set<string>();
  const lineIds = new Set<string>();
  const circleIds = new Set<string>();
  const arcIds = new Set<string>();

  sketch.entities.forEach((entity, index) => {
    if (seenEntityIds.has(entity.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate sketch entity id: ${entity.id}`,
        path: [...path, 'entities', index, 'id'],
      });
    }
    seenEntityIds.add(entity.id);
    if (entity.kind === 'point') pointIds.add(entity.id);
    if (entity.kind === 'line') lineIds.add(entity.id);
    if (entity.kind === 'circle') circleIds.add(entity.id);
    if (entity.kind === 'arc') arcIds.add(entity.id);
  });

  sketch.entities.forEach((entity, index) => {
    if (entity.kind === 'line') {
      if (!pointIds.has(entity.startId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Line references unknown start point: ${entity.startId}`,
          path: [...path, 'entities', index, 'startId'],
        });
      }
      if (!pointIds.has(entity.endId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Line references unknown end point: ${entity.endId}`,
          path: [...path, 'entities', index, 'endId'],
        });
      }
      if (entity.startId === entity.endId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Line startId and endId must differ',
          path: [...path, 'entities', index, 'endId'],
        });
      }
    }
    if (entity.kind === 'circle' && !pointIds.has(entity.centerId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Circle references unknown center point: ${entity.centerId}`,
        path: [...path, 'entities', index, 'centerId'],
      });
    }
    if (entity.kind === 'arc') {
      if (!pointIds.has(entity.centerId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Arc references unknown center point: ${entity.centerId}`,
          path: [...path, 'entities', index, 'centerId'],
        });
      }
      if (entity.startAngle === entity.endAngle) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Arc startAngle and endAngle must differ (zero angular sweep)',
          path: [...path, 'entities', index, 'endAngle'],
        });
      }
    }
  });

  const seenConstraintIds = new Set<string>();
  sketch.constraints.forEach((constraint, index) => {
    if (seenConstraintIds.has(constraint.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate constraint id: ${constraint.id}`,
        path: [...path, 'constraints', index, 'id'],
      });
    }
    seenConstraintIds.add(constraint.id);

    const issue = (message: string, field: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [...path, 'constraints', index, field] });

    switch (constraint.kind) {
      case 'coincident':
        if (!pointIds.has(constraint.pointA)) issue(`Unknown point: ${constraint.pointA}`, 'pointA');
        if (!pointIds.has(constraint.pointB)) issue(`Unknown point: ${constraint.pointB}`, 'pointB');
        break;
      case 'distance':
        if (!pointIds.has(constraint.pointA)) issue(`Unknown point: ${constraint.pointA}`, 'pointA');
        if (!pointIds.has(constraint.pointB)) issue(`Unknown point: ${constraint.pointB}`, 'pointB');
        break;
      case 'horizontal':
      case 'vertical':
        if (!lineIds.has(constraint.lineId)) issue(`Unknown line: ${constraint.lineId}`, 'lineId');
        break;
      case 'radius':
        if (!circleIds.has(constraint.circleId)) issue(`Unknown circle: ${constraint.circleId}`, 'circleId');
        break;
      case 'angle':
        if (!lineIds.has(constraint.lineA)) issue(`Unknown line: ${constraint.lineA}`, 'lineA');
        if (!lineIds.has(constraint.lineB)) issue(`Unknown line: ${constraint.lineB}`, 'lineB');
        if (constraint.lineA === constraint.lineB) {
          issue('Angle constraint must reference two distinct lines', 'lineB');
        }
        break;
    }
  });
}

/** A single feature, self-validated (sketch internal references) but without cross-feature checks. */
export const cadFeatureSchema = z
  .discriminatedUnion('kind', [sketchFeatureSchema, extrudeFeatureSchema])
  .superRefine((feature, ctx) => {
    if (feature.kind === 'sketch') {
      validateSketchReferences(feature, ctx, []);
    }
  });

const cadDocumentV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    units: z.literal('mm'),
    entities: z.array(cadEntitySchema),
    features: z.array(cadFeatureSchema),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const seenFeatureIds = new Set<string>();
    const sketchIds = new Set<string>();

    doc.features.forEach((feature) => {
      if (feature.kind === 'sketch') sketchIds.add(feature.id);
    });

    doc.features.forEach((feature, index) => {
      if (seenFeatureIds.has(feature.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate feature id: ${feature.id}`,
          path: ['features', index, 'id'],
        });
      }
      seenFeatureIds.add(feature.id);

      if (feature.kind === 'extrude' && !sketchIds.has(feature.sketchId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Extrude feature references unknown sketch: ${feature.sketchId}`,
          path: ['features', index, 'sketchId'],
        });
      }
    });
  });

function hasSchemaVersion(value: unknown): value is { schemaVersion: unknown } {
  return typeof value === 'object' && value !== null && 'schemaVersion' in value;
}

export type ParsedCadDocument = { success: true; data: CadDocumentV2 } | { success: false; error: z.ZodError };

/** Accepts a V1 or V2 document and returns the canonical V2 shape; unknown/missing versions fail against the V2 schema. */
export function parseCadDocument(input: unknown): ParsedCadDocument {
  if (hasSchemaVersion(input) && input.schemaVersion === 1) {
    const result = cadDocumentV1Schema.safeParse(input);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, data: migrateToV2(result.data) };
  }

  return cadDocumentV2Schema.safeParse(input);
}
