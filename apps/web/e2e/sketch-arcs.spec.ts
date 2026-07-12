import type { CadDocumentV2, SketchEntity, SketchFeature } from '@swalha-cad/document';
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

function arcs(sketch: SketchFeature): Extract<SketchEntity, { kind: 'arc' }>[] {
  return sketch.entities.filter((entity): entity is Extract<SketchEntity, { kind: 'arc' }> => entity.kind === 'arc');
}

function points(sketch: SketchFeature): Extract<SketchEntity, { kind: 'point' }>[] {
  return sketch.entities.filter((entity): entity is Extract<SketchEntity, { kind: 'point' }> => entity.kind === 'point');
}

function isOnGrid(value: number): boolean {
  return Math.abs(value / GRID_SIZE - Math.round(value / GRID_SIZE)) < 1e-9;
}

function hasOffGridPoint(sketch: SketchFeature): boolean {
  return points(sketch).some((p) => !(isOnGrid(p.x) && isOnGrid(p.y)));
}

test('center point arc: three clicks at continuous coordinates', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });

  await page.getByRole('button', { name: 'Arc variants' }).click();
  await page.getByRole('menuitemradio', { name: 'Center point arc' }).click();

  await clickCanvas(page, canvas, 0.47, 0.53); // center (off a grid node)
  await clickCanvas(page, canvas, 0.61, 0.53); // start ray / radius
  await clickCanvas(page, canvas, 0.47, 0.37); // sweep
  await expect(canvas.locator('.sketch-overlay__arc')).toHaveCount(1);

  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  const sketch = await savedSketch(page);
  expect(arcs(sketch)).toHaveLength(1);
  expect(hasOffGridPoint(sketch)).toBe(true);
});

test('3-point arc: passes through two endpoints and a middle click', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });

  // The Arc primary button defaults to the 3-point variant.
  await page.getByRole('button', { name: 'Arc', exact: true }).click();

  await clickCanvas(page, canvas, 0.4, 0.51);
  await clickCanvas(page, canvas, 0.6, 0.51);
  await clickCanvas(page, canvas, 0.5, 0.36);
  await expect(canvas.locator('.sketch-overlay__arc')).toHaveCount(1);

  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  const sketch = await savedSketch(page);
  expect(arcs(sketch)).toHaveLength(1);
  const arc = arcs(sketch)[0]!;
  const center = points(sketch).find((p) => p.id === arc.centerId);
  expect(center).toBeDefined();
});

test('tangent arc: continues from a line endpoint', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });

  // Draw a short horizontal line first.
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await clickCanvas(page, canvas, 0.4, 0.55);
  await clickCanvas(page, canvas, 0.58, 0.55);
  await page.keyboard.press('Enter');

  // Tangent arc continuing from the line's end point.
  await page.getByRole('button', { name: 'Arc variants' }).click();
  await page.getByRole('menuitemradio', { name: 'Tangent arc' }).click();
  await clickCanvas(page, canvas, 0.58, 0.55); // snaps onto the line endpoint
  await clickCanvas(page, canvas, 0.58, 0.34); // arc end well off the tangent line
  await expect(canvas.locator('.sketch-overlay__arc')).toHaveCount(1);

  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  const sketch = await savedSketch(page);
  expect(arcs(sketch)).toHaveLength(1);
});

test('slot: two side lines and two cap arcs at continuous coordinates', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });

  await page.getByRole('button', { name: 'Slot' }).click();
  await clickCanvas(page, canvas, 0.41, 0.52); // first cap center (off-grid)
  await clickCanvas(page, canvas, 0.63, 0.52); // second cap center
  await clickCanvas(page, canvas, 0.52, 0.44); // width
  await expect(canvas.locator('.sketch-overlay__arc')).toHaveCount(2);
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(2);

  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  const sketch = await savedSketch(page);
  expect(arcs(sketch)).toHaveLength(2);
  expect(sketch.entities.filter((e) => e.kind === 'line')).toHaveLength(2);
  expect(hasOffGridPoint(sketch)).toBe(true);
});
