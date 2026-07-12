import type { CadDocumentV2 } from '@swalha-cad/document';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const HEADER_SIZE = 80;
const TRIANGLE_SIZE = 50;

interface ParsedStl {
  readonly triangleCount: number;
  readonly bounds: { readonly min: [number, number, number]; readonly max: [number, number, number] };
  readonly coordinates: readonly number[];
}

/** Independent binary STL reader (spec-driven, not reused from the exporter) for e2e verification. */
function parseBinaryStl(bytes: Buffer): ParsedStl {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangleCount = view.getUint32(HEADER_SIZE, true);
  const expectedSize = HEADER_SIZE + 4 + triangleCount * TRIANGLE_SIZE;
  expect(bytes.byteLength).toBe(expectedSize);

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const coordinates: number[] = [];
  let offset = HEADER_SIZE + 4;
  for (let i = 0; i < triangleCount; i++) {
    offset += 12; // normal
    for (let v = 0; v < 3; v++) {
      const x = view.getFloat32(offset, true);
      const y = view.getFloat32(offset + 4, true);
      const z = view.getFloat32(offset + 8, true);
      offset += 12;
      coordinates.push(x, y, z);
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (z > max[2]) max[2] = z;
    }
    offset += 2; // attribute byte count
  }

  return { triangleCount, bounds: { min, max }, coordinates };
}

test('saves a document, reloads it, and exports a parseable STL with expected world bounds', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('group', { name: 'Add primitive' }).getByRole('button', { name: 'Add L-Bracket' }).click();
  const properties = page.getByRole('complementary', { name: 'Properties' });

  await properties.getByLabel('Width').fill('77');
  await properties.getByLabel('Width').press('Tab');
  await properties.getByLabel('Translate X').fill('120');
  await properties.getByLabel('Translate X').press('Tab');
  await expect(properties.getByLabel('Width')).toHaveValue('77');
  await expect(properties.getByLabel('Translate X')).toHaveValue('120');

  const saveDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const savedDocumentPath = await (await saveDownload).path();
  expect(savedDocumentPath).toBeTruthy();

  const savedJson = JSON.parse(await readFile(savedDocumentPath!, 'utf-8')) as CadDocumentV2;
  expect(savedJson.schemaVersion).toBe(2);
  expect(savedJson.units).toBe('mm');
  // A fresh Part Studio is demo-free, so the saved document holds exactly the one added body.
  expect(savedJson.entities).toHaveLength(1);
  const savedBracket = savedJson.entities.find((entity) => entity.name === 'L-Bracket');
  expect(savedBracket).toBeDefined();
  expect(savedBracket?.primitive).toMatchObject({ kind: 'lBracket', width: 77 });
  expect(savedBracket?.transform.translation).toEqual([120, 0, 0]);

  // A fresh load starts demo-free again, without the added entity.
  await page.reload();
  const sceneTree = page.getByRole('navigation', { name: 'Scene tree' });
  await expect(sceneTree.getByRole('button', { name: 'L-Bracket' })).toHaveCount(0);

  await page.locator('input[type="file"]').setInputFiles(savedDocumentPath!);
  await sceneTree.getByRole('button', { name: 'L-Bracket' }).click();
  await expect(properties.getByLabel('Width')).toHaveValue('77');
  await expect(properties.getByLabel('Translate X')).toHaveValue('120');

  const stlDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export STL', exact: true }).click();
  const stlPath = await (await stlDownload).path();
  expect(stlPath).toBeTruthy();

  const stlBytes = await readFile(stlPath!);
  const parsed = parseBinaryStl(stlBytes);
  expect(parsed.triangleCount).toBeGreaterThan(0);
  for (const coordinate of parsed.coordinates) {
    expect(Number.isFinite(coordinate)).toBe(true);
  }

  // Expected world bounds of the single edited L-Bracket (translate X 120, width 77,
  // height 50 centred in Y), proving the exported geometry reflects the loaded document.
  expect(parsed.bounds.max[0]).toBeCloseTo(158.5, 1); // translate 120 + half-width 38.5
  expect(parsed.bounds.min[0]).toBeCloseTo(81.5, 1); // translate 120 - half-width 38.5
  expect(parsed.bounds.min[1]).toBeCloseTo(-25, 1); // height 50 centred
  expect(parsed.bounds.max[1]).toBeCloseTo(25, 1);
});
