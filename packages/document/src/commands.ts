import { z } from 'zod';
import { cadEntitySchema } from './schema.js';
import type { CadEntity } from './types.js';

export type CadEntityPatch = Partial<Omit<CadEntity, 'id'>>;

export type CadCommand =
  | { type: 'entity.create'; entity: CadEntity }
  | { type: 'entity.update'; id: string; patch: CadEntityPatch }
  | { type: 'entity.delete'; id: string };

const entityPatchSchema = cadEntitySchema.omit({ id: true }).partial().strict();

const cadCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('entity.create'), entity: cadEntitySchema }),
  z.object({ type: z.literal('entity.update'), id: z.string(), patch: entityPatchSchema }),
  z.object({ type: z.literal('entity.delete'), id: z.string() }),
]);

export function parseCadCommand(input: unknown) {
  return cadCommandSchema.safeParse(input);
}
