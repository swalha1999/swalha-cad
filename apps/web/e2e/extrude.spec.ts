import type { CadDocumentV2, ExtrudeFeature } from '@swalha-cad/document';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

const HEADER_SIZE = 80;

interface ParsedStl {
  readonly triangleCount: number;
  readonly bounds: { readonly min: [number, number, number]; readonly max: [number, number, number] };
}

/** Independent binary STL reader (spec-driven) for e2e verification of the exported solid. */
function parseBinaryStl(bytes: Buffer): ParsedStl {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangleCount = view.getUint32(HEADER_SIZE, true);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let offset = HEADER_SIZE + 4;
  for (let i = 0; i < triangleCount; i++) {
    offset += 12; // facet normal
    for (let v = 0; v < 3; v++) {
      const x = view.getFloat32(offset, true);
      const y = view.getFloat32(offset + 4, true);
      const z = view.getFloat32(offset + 8, true);
      offset += 12;
      min[0] = Math.min(min[0], x);
      min[1] = Math.min(min[1], y);
      min[2] = Math.min(min[2], z);
      max[0] = Math.max(max[0], x);
      max[1] = Math.max(max[1], y);
      max[2] = Math.max(max[2], z);
    }
    offset += 2; // attribute byte count
  }
  return { triangleCount, bounds: { min, max } };
}

async function clickCanvas(page: Page, canvas: Locator, fx: number, fy: number): Promise<void> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('sketch canvas has no bounding box');
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

async function enterXySketch(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Sketch' }).click();
  await page.getByRole('menuitem', { name: 'Top Plane (XY)' }).click();
  await expect(page.getByRole('toolbar', { name: 'Sketch tools' })).toBeVisible();
  return page.getByRole('img', { name: 'Sketch canvas' });
}

/** Draws a corner rectangle profile on the active XY sketch and returns to the Part Studio. */
async function drawRectangleAndFinish(page: Page): Promise<void> {
  const canvas = await enterXySketch(page);
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await clickCanvas(page, canvas, 0.35, 0.4);
  await clickCanvas(page, canvas, 0.62, 0.62);
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(4);
  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await expect(page.getByRole('toolbar', { name: 'Sketch tools' })).toHaveCount(0);
}

function extrudeDialog(page: Page): Locator {
  return page.getByRole('form', { name: 'Extrude' });
}

/** Opens the extrude task, sets a depth, and confirms it, waiting for the panel to close. */
async function extrudeWithDepth(page: Page, depth: number): Promise<void> {
  await page.getByRole('button', { name: 'Extrude' }).click();
  const dialog = extrudeDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Depth').fill(String(depth));
  await dialog.getByRole('button', { name: 'Confirm extrude' }).click();
  await expect(dialog).toHaveCount(0);
}

async function exportStl(page: Page): Promise<ParsedStl> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export STL', exact: true }).click();
  const path = await (await download).path();
  expect(path).toBeTruthy();
  return parseBinaryStl(await readFile(path!));
}

test('extrudes a rectangle profile into a solid and undo/redo the whole feature', async ({ page }) => {
  await page.goto('/');
  await drawRectangleAndFinish(page);

  const sceneTree = page.getByRole('navigation', { name: 'Scene tree' });
  const before = await exportStl(page);

  await extrudeWithDepth(page, 40);
  await expect(sceneTree.getByRole('button', { name: 'Extrude 1' })).toBeVisible();

  // The exported solid now reaches the extruded depth along the XY plane normal (+Z).
  const after = await exportStl(page);
  expect(after.triangleCount).toBeGreaterThan(before.triangleCount);
  expect(after.bounds.max[2]).toBeCloseTo(40, 1);

  // Exactly one undoable transaction: undo removes the extrude, redo restores it.
  await page.keyboard.press('Control+z');
  await expect(sceneTree.getByRole('button', { name: 'Extrude 1' })).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(sceneTree.getByRole('button', { name: 'Extrude 1' })).toBeVisible();
});

test('extrudes a circle profile into a solid', async ({ page }) => {
  await page.goto('/');
  const canvas = await enterXySketch(page);
  await page.getByRole('button', { name: 'Circle', exact: true }).click();
  await clickCanvas(page, canvas, 0.5, 0.45);
  await clickCanvas(page, canvas, 0.58, 0.45);
  await expect(canvas.locator('.sketch-overlay__circle')).toHaveCount(1);
  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  await extrudeWithDepth(page, 20);
  await expect(page.getByRole('navigation', { name: 'Scene tree' }).getByRole('button', { name: 'Extrude 1' })).toBeVisible();
  const stl = await exportStl(page);
  expect(stl.bounds.max[2]).toBeCloseTo(20, 1);
});

test('extrudes a slot profile through the existing arc/line geometry support', async ({ page }) => {
  await page.goto('/');
  const canvas = await enterXySketch(page);
  await page.getByRole('button', { name: 'Slot' }).click();
  await clickCanvas(page, canvas, 0.41, 0.52);
  await clickCanvas(page, canvas, 0.63, 0.52);
  await clickCanvas(page, canvas, 0.52, 0.44);
  await expect(canvas.locator('.sketch-overlay__arc')).toHaveCount(2);
  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  // Depth exceeds the seed cylinder's z-extent (15mm) so the export's far face is the slot's.
  await extrudeWithDepth(page, 22);
  await expect(page.getByRole('navigation', { name: 'Scene tree' }).getByRole('button', { name: 'Extrude 1' })).toBeVisible();
  const stl = await exportStl(page);
  expect(stl.bounds.max[2]).toBeCloseTo(22, 1);
});

test('cancelling the extrude task leaves the document unchanged', async ({ page }) => {
  await page.goto('/');
  await drawRectangleAndFinish(page);
  const before = await exportStl(page);

  await page.getByRole('button', { name: 'Extrude' }).click();
  const dialog = extrudeDialog(page);
  await dialog.getByLabel('Depth').fill('50');
  await dialog.getByRole('button', { name: 'Cancel extrude' }).click();
  await expect(dialog).toHaveCount(0);

  // No solid was committed; the export is identical to before opening the task.
  await expect(page.getByRole('navigation', { name: 'Scene tree' }).getByRole('button', { name: 'Extrude 1' })).toHaveCount(0);
  const after = await exportStl(page);
  expect(after.triangleCount).toBe(before.triangleCount);
});

test('edits an existing extrude depth via double-click and rebuilds the solid', async ({ page }) => {
  await page.goto('/');
  await drawRectangleAndFinish(page);
  await extrudeWithDepth(page, 40);
  expect((await exportStl(page)).bounds.max[2]).toBeCloseTo(40, 1);

  // Double-clicking the feature re-opens the task pre-loaded with its current depth.
  await page.getByRole('navigation', { name: 'Scene tree' }).getByRole('button', { name: 'Extrude 1' }).dblclick();
  const dialog = extrudeDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Depth')).toHaveValue('40');
  // Shrink the solid but stay above the seed cylinder's 15mm z-extent so the far face is the extrude's.
  await dialog.getByLabel('Depth').fill('22');
  await dialog.getByRole('button', { name: 'Confirm extrude' }).click();
  await expect(dialog).toHaveCount(0);

  // Still a single feature, now rebuilt to the shallower depth.
  await expect(page.getByRole('navigation', { name: 'Scene tree' }).getByRole('button', { name: 'Extrude 1' })).toHaveCount(1);
  expect((await exportStl(page)).bounds.max[2]).toBeCloseTo(22, 1);
});

test('persists an extrude across save and reload, exporting a matching STL', async ({ page }) => {
  await page.goto('/');
  await drawRectangleAndFinish(page);
  await extrudeWithDepth(page, 30);

  const saveDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const savedPath = await (await saveDownload).path();
  const saved = JSON.parse(await readFile(savedPath!, 'utf-8')) as CadDocumentV2;
  const savedExtrude = saved.features.find((feature): feature is ExtrudeFeature => feature.kind === 'extrude');
  expect(savedExtrude).toMatchObject({ kind: 'extrude', depth: 30, direction: 'normal' });

  const sceneTree = page.getByRole('navigation', { name: 'Scene tree' });
  await page.reload();
  await expect(sceneTree.getByRole('button', { name: 'Extrude 1' })).toHaveCount(0);

  await page.locator('input[type="file"]').setInputFiles(savedPath!);
  await expect(sceneTree.getByRole('button', { name: 'Extrude 1' })).toBeVisible();
  expect((await exportStl(page)).bounds.max[2]).toBeCloseTo(30, 1);
});
