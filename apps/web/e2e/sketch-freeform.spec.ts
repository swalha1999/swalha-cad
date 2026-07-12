import type { CadDocumentV2, SketchFeature } from '@swalha-cad/document';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

const GRID_SIZE = 10;

/** Clicks the sketch canvas at a fractional offset within its bounding box. */
async function clickCanvas(page: Page, canvas: Locator, fx: number, fy: number): Promise<void> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('sketch canvas has no bounding box');
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

async function enterXySketch(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sketch' }).click();
  await page.getByRole('menuitem', { name: 'Top Plane (XY)' }).click();
  await expect(page.getByRole('toolbar', { name: 'Sketch tools' })).toBeVisible();
}

async function savedSketch(page: Page): Promise<SketchFeature> {
  const saveDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const savedPath = await (await saveDownload).path();
  const saved = JSON.parse(await readFile(savedPath!, 'utf-8')) as CadDocumentV2;
  const sketch = saved.features.find((feature): feature is SketchFeature => feature.kind === 'sketch');
  if (!sketch) throw new Error('expected a saved sketch feature');
  return sketch;
}

/** True only when a coordinate lands exactly on a grid node (i.e. was quantized). */
function isOnGrid(value: number): boolean {
  return Math.abs(value / GRID_SIZE - Math.round(value / GRID_SIZE)) < 1e-9;
}

test('places geometry at arbitrary continuous (non-grid) coordinates', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });

  // Grid snapping is off by default, so a click lands on the exact continuous
  // coordinate under the cursor rather than being quantized to a grid node.
  await page.getByRole('button', { name: 'Point' }).click();
  await clickCanvas(page, canvas, 0.413, 0.367);
  await expect(canvas.locator('.sketch-overlay__point')).toHaveCount(1);

  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  const sketch = await savedSketch(page);
  const point = sketch.entities.find((entity) => entity.kind === 'point');
  expect(point).toBeDefined();
  if (point?.kind !== 'point') throw new Error('unreachable');
  // At least one axis is off-grid: the coordinate was never quantized.
  expect(isOnGrid(point.x) && isOnGrid(point.y)).toBe(false);
});

test('draws with the grid hidden and snapping still off (continuous placement)', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });

  // The grid is an independent visual aid: hiding it must not disable drawing.
  await expect(canvas.locator('.sketch-overlay__grid')).toHaveCount(1);
  await page.getByRole('button', { name: 'Show grid' }).click();
  await expect(canvas.locator('.sketch-overlay__grid')).toHaveCount(0);

  // Drawing still works with the grid hidden.
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await clickCanvas(page, canvas, 0.34, 0.41);
  await clickCanvas(page, canvas, 0.63, 0.6);
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(4);

  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  // The corners are continuous coordinates, not quantized grid nodes.
  const sketch = await savedSketch(page);
  const offGrid = sketch.entities.some((entity) => entity.kind === 'point' && !(isOnGrid(entity.x) && isOnGrid(entity.y)));
  expect(offGrid).toBe(true);
});
