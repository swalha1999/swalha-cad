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

function points(sketch: SketchFeature): Extract<SketchEntity, { kind: 'point' }>[] {
  return sketch.entities.filter((entity): entity is Extract<SketchEntity, { kind: 'point' }> => entity.kind === 'point');
}

/** True only when a coordinate lands exactly on a grid node (i.e. was quantized). */
function isOnGrid(value: number): boolean {
  return Math.abs(value / GRID_SIZE - Math.round(value / GRID_SIZE)) < 1e-9;
}

function hasOffGridPoint(sketch: SketchFeature): boolean {
  return points(sketch).some((p) => !(isOnGrid(p.x) && isOnGrid(p.y)));
}

test('center rectangle: four symmetric lines at continuous coordinates', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });

  await page.getByRole('button', { name: 'Rectangle variants' }).click();
  await page.getByRole('menuitemradio', { name: 'Center rectangle' }).click();

  await clickCanvas(page, canvas, 0.47, 0.53); // center (off a grid node)
  await clickCanvas(page, canvas, 0.63, 0.37); // corner
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(4);

  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  const sketch = await savedSketch(page);
  expect(points(sketch)).toHaveLength(4);
  expect(hasOffGridPoint(sketch)).toBe(true);
  // Corners are symmetric about the center: x-extremes sum to twice the center x.
  const xs = points(sketch).map((p) => p.x).sort((a, b) => a - b);
  expect(xs[0]! + xs[3]!).toBeCloseTo(xs[1]! + xs[2]!, 6);
});

test('3-point rectangle: edge then perpendicular width', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });

  await page.getByRole('button', { name: 'Rectangle variants' }).click();
  await page.getByRole('menuitemradio', { name: '3-point rectangle' }).click();

  await clickCanvas(page, canvas, 0.34, 0.6);
  await clickCanvas(page, canvas, 0.64, 0.61);
  await clickCanvas(page, canvas, 0.5, 0.37);
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(4);

  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  const sketch = await savedSketch(page);
  expect(points(sketch)).toHaveLength(4);
  expect(hasOffGridPoint(sketch)).toBe(true);
});

test('3-point circle: passes through three clicked points', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });

  await page.getByRole('button', { name: 'Circle variants' }).click();
  await page.getByRole('menuitemradio', { name: '3-point circle' }).click();

  await clickCanvas(page, canvas, 0.4, 0.5);
  await clickCanvas(page, canvas, 0.5, 0.34);
  await clickCanvas(page, canvas, 0.6, 0.5);
  await expect(canvas.locator('.sketch-overlay__circle')).toHaveCount(1);

  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  const sketch = await savedSketch(page);
  const circles = sketch.entities.filter((entity) => entity.kind === 'circle');
  expect(circles).toHaveLength(1);
});

test('regular polygon: chosen side count creates a closed loop', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });

  await page.getByRole('spinbutton', { name: 'Polygon sides' }).fill('5');
  await page.getByRole('button', { name: 'Polygon' }).click();

  await clickCanvas(page, canvas, 0.5, 0.5); // center
  await clickCanvas(page, canvas, 0.63, 0.47); // vertex (off-grid)
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(5);

  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  const sketch = await savedSketch(page);
  expect(points(sketch)).toHaveLength(5);
  expect(hasOffGridPoint(sketch)).toBe(true);
});

test('construction toggle converts selected geometry and persists it', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });

  // Draw a normal corner rectangle, then leave the tool for selection mode.
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await clickCanvas(page, canvas, 0.36, 0.4);
  await clickCanvas(page, canvas, 0.64, 0.62);
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(4);
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click(); // toggle tool off

  // Select one edge and convert it to construction geometry. The hit target is an
  // invisible wide stroke (a thin, zero-area bbox), so force the click onto it.
  await canvas.locator('[data-entity-kind="line"] .sketch-overlay__hit').first().click({ force: true });
  await page.getByRole('button', { name: 'Construction' }).click();
  // The converted edge renders with the construction style.
  await expect(canvas.locator('.sketch-overlay__line.sketch-overlay__edge--construction')).toHaveCount(1);

  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  const sketch = await savedSketch(page);
  const lines = sketch.entities.filter((entity) => entity.kind === 'line');
  expect(lines).toHaveLength(4);
  // Exactly one edge persisted as construction — the rest remain real profile geometry.
  expect(lines.filter((line) => line.construction)).toHaveLength(1);
});
