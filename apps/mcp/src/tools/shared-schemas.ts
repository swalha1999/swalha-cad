import { z } from 'zod';

/** Millimetre/degree tuple shared by both the input schema and the document model. */
export const vec3InputSchema = z.tuple([z.number(), z.number(), z.number()]);

/** A transform where every field must be supplied in full, matching `CadEntityPatch` semantics. */
export const fullTransformInputSchema = z.object({
  translation: vec3InputSchema,
  rotationDeg: vec3InputSchema,
  scale: vec3InputSchema,
});

/** A transform where every field is optional; omitted fields default to identity when an entity is created. */
export const partialTransformInputSchema = z.object({
  translation: vec3InputSchema.optional(),
  rotationDeg: vec3InputSchema.optional(),
  scale: vec3InputSchema.optional(),
});

export const primitiveInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('box'),
    width: z.number(),
    height: z.number(),
    depth: z.number(),
  }),
  z.object({
    kind: z.literal('cylinder'),
    radius: z.number(),
    height: z.number(),
    segments: z.number().int(),
  }),
  z.object({
    kind: z.literal('lBracket'),
    width: z.number(),
    height: z.number(),
    depth: z.number(),
    thickness: z.number(),
  }),
]);

const DEFAULT_NAMES: Record<z.infer<typeof primitiveInputSchema>['kind'], string> = {
  box: 'Box',
  cylinder: 'Cylinder',
  lBracket: 'L-Bracket',
};

export function defaultEntityName(kind: z.infer<typeof primitiveInputSchema>['kind']): string {
  return DEFAULT_NAMES[kind];
}

const IDENTITY_TRANSLATION: readonly [number, number, number] = [0, 0, 0];
const IDENTITY_ROTATION: readonly [number, number, number] = [0, 0, 0];
const IDENTITY_SCALE: readonly [number, number, number] = [1, 1, 1];

export function resolveTransform(input: z.infer<typeof partialTransformInputSchema> | undefined) {
  return {
    translation: input?.translation ?? IDENTITY_TRANSLATION,
    rotationDeg: input?.rotationDeg ?? IDENTITY_ROTATION,
    scale: input?.scale ?? IDENTITY_SCALE,
  };
}
