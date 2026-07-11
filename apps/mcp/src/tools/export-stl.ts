import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { exportDocumentToBinaryStl } from '@swalha-cad/export';
import type { DocumentSession } from '../document-session.js';
import { runTool } from '../tool-result.js';

const STL_MIME_TYPE = 'model/stl';
const STL_RESOURCE_URI = 'swalha-cad://export.stl';

/**
 * Registers `export_stl`: bakes every visible entity's transform into
 * world-space triangles via the shared export package and returns the
 * binary STL as a base64 embedded resource (millimetre coordinates).
 */
export function registerExportStlTool(server: McpServer, session: DocumentSession): void {
  server.registerTool(
    'export_stl',
    {
      title: 'Export STL',
      description: 'Export the visible entities in the CAD document as a binary STL file (millimetres).',
      inputSchema: {},
    },
    () =>
      runTool(async (): Promise<CallToolResult> => {
        const bytes = exportDocumentToBinaryStl(session.getDocument());
        const triangleCount = bytes.length >= 84 ? new DataView(bytes.buffer, bytes.byteOffset).getUint32(80, true) : 0;

        return {
          content: [
            { type: 'text', text: `Exported ${triangleCount} triangles.` },
            {
              type: 'resource',
              resource: {
                uri: STL_RESOURCE_URI,
                mimeType: STL_MIME_TYPE,
                blob: Buffer.from(bytes).toString('base64'),
              },
            },
          ],
        };
      }),
  );
}
