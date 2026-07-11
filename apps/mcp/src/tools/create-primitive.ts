import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CadCommand, CadEntity } from '@swalha-cad/document';
import { parseCadCommand } from '@swalha-cad/document';
import type { DocumentSession } from '../document-session.js';
import { runTool, toolErrorResult, toolJsonResult } from '../tool-result.js';
import { defaultEntityName, partialTransformInputSchema, primitiveInputSchema, resolveTransform } from './shared-schemas.js';

export const createPrimitiveInputShape = {
  primitive: primitiveInputSchema,
  name: z.string().min(1).optional(),
  transform: partialTransformInputSchema.optional(),
};

/**
 * Registers `create_primitive`: builds a fully-formed `CadEntity`, validates
 * it as an `entity.create` command via the document package's canonical Zod
 * schema (so dimension/thickness rules live in one place), then applies it
 * through the shared reducer.
 */
export function registerCreatePrimitiveTool(server: McpServer, session: DocumentSession): void {
  server.registerTool(
    'create_primitive',
    {
      title: 'Create primitive',
      description: 'Create a box, cylinder, or L-bracket entity in the CAD document (millimetres).',
      inputSchema: createPrimitiveInputShape,
    },
    (args) =>
      runTool(async () => {
        const entity: CadEntity = {
          id: session.nextId(),
          name: args.name ?? defaultEntityName(args.primitive.kind),
          primitive: args.primitive,
          transform: resolveTransform(args.transform),
          visible: true,
        };

        const command: CadCommand = { type: 'entity.create', entity };
        const validation = parseCadCommand(command);
        if (!validation.success) {
          return toolErrorResult('invalid_primitive', validation.error.message);
        }

        await session.applyCommand(command);
        return toolJsonResult({ entity });
      }),
  );
}
