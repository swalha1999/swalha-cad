import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CadCommand, SketchFeature } from '@swalha-cad/document';
import { parseCadCommand } from '@swalha-cad/document';
import type { DocumentSession } from '../document-session.js';
import { runTool, toolErrorResult, toolJsonResult } from '../tool-result.js';
import { nextFeatureName, sketchPlaneSchema } from './feature-helpers.js';

export const createSketchInputShape = {
  plane: sketchPlaneSchema,
  name: z.string().min(1).optional(),
};

/**
 * Registers `create_sketch`: appends an empty sketch feature on the chosen
 * origin plane (XY/XZ/YZ) via a `feature.create` command, mirroring the
 * browser's `enterSketch`. Entities and constraints are added afterwards with
 * `add_sketch_entity` / `add_constraint`.
 */
export function registerCreateSketchTool(server: McpServer, session: DocumentSession): void {
  server.registerTool(
    'create_sketch',
    {
      title: 'Create sketch',
      description: 'Create an empty 2D sketch on the XY, XZ, or YZ origin plane. Returns the sketch id for adding geometry.',
      inputSchema: createSketchInputShape,
    },
    (args) =>
      runTool(async () => {
        const feature: SketchFeature = {
          id: session.nextId(),
          kind: 'sketch',
          name: args.name ?? nextFeatureName(session.getDocument().features, 'Sketch'),
          plane: args.plane,
          entities: [],
          constraints: [],
          visible: true,
        };

        const command: CadCommand = { type: 'feature.create', feature };
        const validation = parseCadCommand(command);
        if (!validation.success) {
          return toolErrorResult('invalid_sketch', validation.error.message);
        }

        await session.applyCommand(command);
        return toolJsonResult({ feature });
      }),
  );
}
