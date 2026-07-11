import { z } from 'zod';
import { cadEntitySchema, cadFeatureSchema, extrudeFeatureSchema, sketchFeatureSchema } from './schema.js';
import type { CadEntity, CadFeature, ExtrudeFeature, SketchFeature } from './types.js';

export type CadEntityPatch = Partial<Omit<CadEntity, 'id'>>;

export type CadFeaturePatch = Partial<Omit<SketchFeature, 'id' | 'kind'>> | Partial<Omit<ExtrudeFeature, 'id' | 'kind'>>;

export type CadCommand =
  | { type: 'entity.create'; entity: CadEntity }
  | { type: 'entity.update'; id: string; patch: CadEntityPatch }
  | { type: 'entity.delete'; id: string }
  | { type: 'feature.create'; feature: CadFeature }
  | { type: 'feature.update'; id: string; patch: CadFeaturePatch }
  | { type: 'feature.delete'; id: string }
  /**
   * An ordered group of commands applied as one indivisible unit: the reducer
   * runs them in sequence against a single document and the history records
   * exactly one undoable entry. Used for dependency-aware deletion, where a
   * feature and its downstream dependents must vanish (and return on undo)
   * together. Nested batches are permitted and flattened by the reducer.
   */
  | { type: 'batch'; commands: CadCommand[] };

const entityPatchSchema = cadEntitySchema.omit({ id: true }).partial().strict();

const sketchFeaturePatchSchema = sketchFeatureSchema.omit({ id: true, kind: true }).partial().strict();
const extrudeFeaturePatchSchema = extrudeFeatureSchema.omit({ id: true, kind: true }).partial().strict();
const featurePatchSchema = z.union([sketchFeaturePatchSchema, extrudeFeaturePatchSchema]);

const nonBatchCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('entity.create'), entity: cadEntitySchema }),
  z.object({ type: z.literal('entity.update'), id: z.string(), patch: entityPatchSchema }),
  z.object({ type: z.literal('entity.delete'), id: z.string() }),
  z.object({ type: z.literal('feature.create'), feature: cadFeatureSchema }),
  z.object({ type: z.literal('feature.update'), id: z.string(), patch: featurePatchSchema }),
  z.object({ type: z.literal('feature.delete'), id: z.string() }),
]);

/**
 * Recursive so a `batch` can itself contain batches; the reducer applies them in
 * order. Typed as `ZodTypeAny` (rather than `ZodType<CadCommand>`) because the
 * self-reference requires an explicit annotation and Zod's inferred optional
 * shape differs from the hand-written patch types under exactOptionalPropertyTypes.
 */
const cadCommandSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([
    nonBatchCommandSchema,
    z.object({ type: z.literal('batch'), commands: z.array(cadCommandSchema) }).strict(),
  ]),
);

export function parseCadCommand(input: unknown) {
  return cadCommandSchema.safeParse(input);
}
