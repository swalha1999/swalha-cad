import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DocumentSession } from '../document-session.js';
import { runTool, toolJsonResult } from '../tool-result.js';

/** Registers `list_entities`: a read-only snapshot of every entity currently in the document. */
export function registerListEntitiesTool(server: McpServer, session: DocumentSession): void {
  server.registerTool(
    'list_entities',
    {
      title: 'List entities',
      description: 'List every entity currently in the CAD document.',
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        return toolJsonResult({ entities: session.getDocument().entities });
      }),
  );
}
