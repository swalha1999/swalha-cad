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
  | { type: 'feature.delete'; id: string };

const entityPatchSchema = cadEntitySchema.omit({ id: true }).partial().strict();

const sketchFeaturePatchSchema = sketchFeatureSchema.omit({ id: true, kind: true }).partial().strict();
const extrudeFeaturePatchSchema = extrudeFeatureSchema.omit({ id: true, kind: true }).partial().strict();
const featurePatchSchema = z.union([sketchFeaturePatchSchema, extrudeFeaturePatchSchema]);

const cadCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('entity.create'), entity: cadEntitySchema }),
  z.object({ type: z.literal('entity.update'), id: z.string(), patch: entityPatchSchema }),
  z.object({ type: z.literal('entity.delete'), id: z.string() }),
  z.object({ type: z.literal('feature.create'), feature: cadFeatureSchema }),
  z.object({ type: z.literal('feature.update'), id: z.string(), patch: featurePatchSchema }),
  z.object({ type: z.literal('feature.delete'), id: z.string() }),
]);

export function parseCadCommand(input: unknown) {
  return cadCommandSchema.safeParse(input);
}
