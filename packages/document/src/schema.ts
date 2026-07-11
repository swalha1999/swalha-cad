import { z } from 'zod';

const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

const transformSchema = z.object({
  translation: vec3Schema,
  rotationDeg: vec3Schema,
  scale: vec3Schema,
});

const positive = z.number().positive();

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

const cadEntitySchema = z.object({
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

export function parseCadDocument(input: unknown) {
  return cadDocumentV1Schema.safeParse(input);
}
