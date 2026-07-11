import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DocumentSession } from '../document-session.js';
import { runTool, toolJsonResult } from '../tool-result.js';

export const deleteEntityInputShape = {
  id: z.string(),
};

/** Registers `delete_entity`: applies an `entity.delete` command through the shared reducer. */
export function registerDeleteEntityTool(server: McpServer, session: DocumentSession): void {
  server.registerTool(
    'delete_entity',
    {
      title: 'Delete entity',
      description: 'Delete an entity from the CAD document by id.',
      inputSchema: deleteEntityInputShape,
    },
    (args) =>
      runTool(async () => {
        await session.applyCommand({ type: 'entity.delete', id: args.id });
        return toolJsonResult({ deletedId: args.id });
      }),
  );
}
