import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CadCommand, CadEntityPatch } from '@swalha-cad/document';
import { parseCadCommand } from '@swalha-cad/document';
import type { DocumentSession } from '../document-session.js';
import { runTool, toolErrorResult, toolJsonResult } from '../tool-result.js';
import { fullTransformInputSchema, primitiveInputSchema } from './shared-schemas.js';

const entityPatchInputSchema = z.object({
  name: z.string().min(1).optional(),
  visible: z.boolean().optional(),
  primitive: primitiveInputSchema.optional(),
  transform: fullTransformInputSchema.optional(),
});

export const updateEntityInputShape = {
  id: z.string(),
  patch: entityPatchInputSchema,
};

/**
 * Registers `update_entity`: validates `{ id, patch }` as an `entity.update`
 * command via the document package's canonical Zod schema, then applies it
 * through the shared reducer. `patch.transform`/`patch.primitive`, when
 * present, replace the whole sub-object (matching `CadEntityPatch`).
 */
export function registerUpdateEntityTool(server: McpServer, session: DocumentSession): void {
  server.registerTool(
    'update_entity',
    {
      title: 'Update entity',
      description: 'Patch an existing entity (name, visibility, primitive, or transform) by id.',
      inputSchema: updateEntityInputShape,
    },
    (args) =>
      runTool(async () => {
        const patch: CadEntityPatch = {};
        if (args.patch.name !== undefined) patch.name = args.patch.name;
        if (args.patch.visible !== undefined) patch.visible = args.patch.visible;
        if (args.patch.primitive !== undefined) patch.primitive = args.patch.primitive;
        if (args.patch.transform !== undefined) patch.transform = args.patch.transform;

        const command: CadCommand = { type: 'entity.update', id: args.id, patch };
        const validation = parseCadCommand(command);
        if (!validation.success) {
          return toolErrorResult('invalid_patch', validation.error.message);
        }

        const document = await session.applyCommand(command);
        const entity = document.entities.find((candidate) => candidate.id === args.id);
        return toolJsonResult({ entity });
      }),
  );
}
