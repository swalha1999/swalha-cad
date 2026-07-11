import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DocumentSession } from './document-session.js';
import { registerCreatePrimitiveTool } from './tools/create-primitive.js';
import { registerDeleteEntityTool } from './tools/delete-entity.js';
import { registerExportStlTool } from './tools/export-stl.js';
import { registerListEntitiesTool } from './tools/list-entities.js';
import { registerUpdateEntityTool } from './tools/update-entity.js';

export const SERVER_NAME = 'swalha-cad-mcp';
export const SERVER_VERSION = '0.0.0';

/**
 * Builds the MCP server exposing `session`'s document through the same
 * `CadCommand` reducer the browser UI uses: create/list/update/delete
 * entities and export binary STL, all in millimetres.
 */
export function createCadMcpServer(session: DocumentSession): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerCreatePrimitiveTool(server, session);
  registerListEntitiesTool(server, session);
  registerUpdateEntityTool(server, session);
  registerDeleteEntityTool(server, session);
  registerExportStlTool(server, session);

  return server;
}
