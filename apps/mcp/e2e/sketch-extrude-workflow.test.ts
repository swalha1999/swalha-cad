import type { CadDocumentV2 } from '@swalha-cad/document';
import { parseCadDocument } from '@swalha-cad/document';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TSX_BIN = join(PACKAGE_ROOT, 'node_modules', '.bin', 'tsx');

const HEADER_SIZE = 80;
const TRIANGLE_SIZE = 50;

interface ParsedStl {
  readonly triangleCount: number;
  readonly coordinates: readonly number[];
}

/** Independent binary STL reader for e2e verification, not reused from the exporter under test. */
function parseBinaryStl(bytes: Buffer): ParsedStl {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangleCount = view.getUint32(HEADER_SIZE, true);
  expect(bytes.byteLength).toBe(HEADER_SIZE + 4 + triangleCount * TRIANGLE_SIZE);

  const coordinates: number[] = [];
  let offset = HEADER_SIZE + 4;
  for (let i = 0; i < triangleCount; i++) {
    offset += 12; // normal
    for (let v = 0; v < 3; v++) {
      coordinates.push(view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true));
      offset += 12;
    }
    offset += 2; // attribute byte count
  }
  return { triangleCount, coordinates };
}

function jsonOf<T>(result: Record<string, unknown>): T {
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content.find((item) => item.type === 'text')?.text;
  return JSON.parse(text ?? 'null') as T;
}

function stlResource(result: Record<string, unknown>): Buffer {
  const resourceItem = (result.content as Array<Record<string, unknown>>).find((item) => item.type === 'resource') as {
    resource: { blob: string; mimeType: string };
  };
  expect(resourceItem.resource.mimeType).toBe('model/stl');
  return Buffer.from(resourceItem.resource.blob, 'base64');
}

let dir: string;
let documentPath: string;

async function openClient(): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command: TSX_BIN,
    args: ['src/index.ts', documentPath],
    cwd: PACKAGE_ROOT,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'swalha-cad-mcp-sketch-e2e-client', version: '0.0.0' });
  await client.connect(transport);
  return { client, transport };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'swalha-cad-mcp-sketch-e2e-'));
  documentPath = join(dir, 'design.swcad.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface FeaturePayload {
  feature: { id: string };
  created?: { points: string[]; lines: string[] };
}

describe('MCP sketch → extrude workflow (real stdio subprocess)', () => {
  it(
    'builds an arbitrary non-grid constrained sketch, extrudes it, reloads from disk, and exports a parseable STL',
    async () => {
      const { client, transport } = await openClient();

      // 1. Sketch on the XZ plane (not the default XY) with non-grid coordinates.
      const sketch = jsonOf<FeaturePayload>(await client.callTool({ name: 'create_sketch', arguments: { plane: 'XZ' } }));
      const sketchId = sketch.feature.id;

      const rect = jsonOf<FeaturePayload>(
        await client.callTool({
          name: 'add_sketch_entity',
          arguments: { sketchId, entity: { type: 'rectangle', corner: { x: 3.3, y: 2.1 }, opposite: { x: 43.3, y: 27.1 } } },
        }),
      );
      const points = rect.created!.points; // [corner, (ex,sy), opposite, (sx,ey)]
      const lines = rect.created!.lines; // [bottom, right, top, left]

      // 2. Constrain it: bottom horizontal, right vertical, plus two dimensions.
      const horizontal = await client.callTool({ name: 'add_constraint', arguments: { sketchId, constraint: { kind: 'horizontal', lineId: lines[0] } } });
      expect(horizontal.isError).toBeFalsy();
      const vertical = await client.callTool({ name: 'add_constraint', arguments: { sketchId, constraint: { kind: 'vertical', lineId: lines[1] } } });
      expect(vertical.isError).toBeFalsy();
      const widthDim = await client.callTool({
        name: 'add_constraint',
        arguments: { sketchId, constraint: { kind: 'distance', pointA: points[0], pointB: points[1], value: 40 } },
      });
      expect(widthDim.isError).toBeFalsy();
      const heightDim = await client.callTool({
        name: 'add_constraint',
        arguments: { sketchId, constraint: { kind: 'distance', pointA: points[1], pointB: points[2], value: 25 } },
      });
      expect(heightDim.isError).toBeFalsy();

      // 3. Solve and confirm a non-error status.
      const solved = jsonOf<{ status: string }>(await client.callTool({ name: 'solve_sketch', arguments: { sketchId } }));
      expect(['under-constrained', 'fully-constrained']).toContain(solved.status);

      // 4. Symmetric extrude.
      const extrude = jsonOf<{ feature: { id: string }; mesh: { triangleCount: number } }>(
        await client.callTool({ name: 'create_or_update_extrude', arguments: { sketchId, depth: 12.5, direction: 'symmetric' } }),
      );
      expect(extrude.mesh.triangleCount).toBeGreaterThan(0);

      await client.close();

      // 5. Reload from disk in a fresh subprocess and confirm the features persisted.
      const persisted = parseCadDocument(JSON.parse(await readFile(documentPath, 'utf-8')) as unknown);
      expect(persisted.success).toBe(true);
      const document = (persisted as { success: true; data: CadDocumentV2 }).data;
      expect(document.features.filter((feature) => feature.kind === 'sketch')).toHaveLength(1);
      expect(document.features.filter((feature) => feature.kind === 'extrude')).toHaveLength(1);

      const reopened = await openClient();
      const list = jsonOf<{ features: Array<{ id: string; kind: string }> }>(
        await reopened.client.callTool({ name: 'list_features', arguments: {} }),
      );
      expect(list.features.map((feature) => feature.kind).sort()).toEqual(['extrude', 'sketch']);

      // 6. Export and parse the STL.
      const stl = parseBinaryStl(stlResource(await reopened.client.callTool({ name: 'export_stl', arguments: {} })));
      expect(stl.triangleCount).toBeGreaterThan(0);
      for (const coordinate of stl.coordinates) {
        expect(Number.isFinite(coordinate)).toBe(true);
      }
      // Symmetric depth 12.5 straddles the XZ plane (its normal is -Y): |y| <= 6.25 + tolerance.
      for (let i = 1; i < stl.coordinates.length; i += 3) {
        expect(Math.abs(stl.coordinates[i]!)).toBeLessThanOrEqual(6.25 + 1e-3);
      }

      await reopened.client.close();
      void transport;
    },
    30_000,
  );

  it(
    'builds a slot (arc) profile, extrudes it, and exports a parseable STL',
    async () => {
      const { client } = await openClient();

      const sketch = jsonOf<FeaturePayload>(await client.callTool({ name: 'create_sketch', arguments: { plane: 'XY' } }));
      const sketchId = sketch.feature.id;

      const slot = await client.callTool({
        name: 'add_sketch_entity',
        arguments: { sketchId, entity: { type: 'slot', centerA: { x: 1.5, y: 2.5 }, centerB: { x: 31.5, y: 2.5 }, radius: 6.5 } },
      });
      expect(slot.isError).toBeFalsy();

      // The slot is a closed curve loop: get_feature should detect a curve-loop profile.
      const inspected = jsonOf<{ profile: { ok: boolean; profile?: { kind: string } } }>(
        await client.callTool({ name: 'get_feature', arguments: { id: sketchId } }),
      );
      expect(inspected.profile.ok).toBe(true);
      expect(inspected.profile.profile!.kind).toBe('curve-loop');

      const extrude = jsonOf<{ mesh: { triangleCount: number } }>(
        await client.callTool({ name: 'create_or_update_extrude', arguments: { sketchId, depth: 7 } }),
      );
      expect(extrude.mesh.triangleCount).toBeGreaterThan(0);

      const stl = parseBinaryStl(stlResource(await client.callTool({ name: 'export_stl', arguments: {} })));
      expect(stl.triangleCount).toBeGreaterThan(0);

      await client.close();
    },
    30_000,
  );
});
