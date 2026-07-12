import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DocumentSession } from './document-session.js';
import { registerAddConstraintTool } from './tools/add-constraint.js';
import { registerAddSketchEntityTool } from './tools/add-sketch-entity.js';
import { registerCreateExtrudeTool } from './tools/create-extrude.js';
import { registerCreatePrimitiveTool } from './tools/create-primitive.js';
import { registerCreateSketchTool } from './tools/create-sketch.js';
import { registerDeleteEntityTool } from './tools/delete-entity.js';
import { registerExportStlTool } from './tools/export-stl.js';
import { registerGetFeatureTool, registerListFeaturesTool } from './tools/list-features.js';
import { registerListEntitiesTool } from './tools/list-entities.js';
import { registerSolveSketchTool } from './tools/solve-sketch.js';
import { registerUpdateEntityTool } from './tools/update-entity.js';

export const SERVER_NAME = 'swalha-cad-mcp';
export const SERVER_VERSION = '0.0.0';

/**
 * Builds the MCP server exposing `session`'s document through the same
 * `CadCommand` reducer the browser UI uses: create/list/update/delete M1
 * primitive entities, author M2 sketches (geometry + constraints + solve),
 * extrude closed profiles into solids, inspect features, and export binary STL,
 * all in millimetres.
 */
export function createCadMcpServer(session: DocumentSession): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // M1 primitive entities.
  registerCreatePrimitiveTool(server, session);
  registerListEntitiesTool(server, session);
  registerUpdateEntityTool(server, session);
  registerDeleteEntityTool(server, session);

  // M2 sketch + extrude features.
  registerCreateSketchTool(server, session);
  registerAddSketchEntityTool(server, session);
  registerAddConstraintTool(server, session);
  registerSolveSketchTool(server, session);
  registerCreateExtrudeTool(server, session);
  registerListFeaturesTool(server, session);
  registerGetFeatureTool(server, session);

  // Export.
  registerExportStlTool(server, session);

  return server;
}
