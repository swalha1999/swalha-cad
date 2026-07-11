import type { CadDocumentV2, SketchFeature } from '@swalha-cad/document';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

/** Clicks the sketch canvas at a fractional offset within its bounding box. */
async function clickCanvas(page: Page, canvas: Locator, fx: number, fy: number): Promise<void> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('sketch canvas has no bounding box');
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

/** Clicks the centre of a rendered locator's bounding box (used to hit thin lines / small points). */
async function clickCentre(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('target has no bounding box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
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

/** Draws one free (off-grid) line across two canvas clicks and finishes the chain. */
async function drawLine(page: Page, canvas: Locator): Promise<void> {
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await clickCanvas(page, canvas, 0.36, 0.34);
  await clickCanvas(page, canvas, 0.61, 0.55);
  await page.keyboard.press('Enter');
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(1);
}

test('presses D, selects a line, and drives its length to a typed value', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });
  await drawLine(page, canvas);

  // Command-first: D activates the Distance tool, then clicking the line resolves its endpoints.
  await page.keyboard.press('d');
  await clickCentre(page, canvas.locator('.sketch-overlay__line'));

  // The inline numeric editor opens beside the annotation, prefilled and focused.
  const editor = page.getByLabel('Dimension value');
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('dimension-annotation')).toBeVisible();
  await editor.fill('42.5');
  await editor.press('Enter');

  // The tool returns to selection and the solver drives the line to exactly 42.5 mm.
  await expect(page.getByLabel('Dimension value')).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  const sketch = await savedSketch(page);
  const distance = sketch.constraints.find((constraint) => constraint.kind === 'distance');
  expect(distance?.kind === 'distance' && distance.value).toBe(42.5);
  const points = sketch.entities.filter((entity): entity is Extract<typeof entity, { kind: 'point' }> => entity.kind === 'point');
  expect(Math.hypot(points[1]!.x - points[0]!.x, points[1]!.y - points[0]!.y)).toBeCloseTo(42.5, 3);
});

test('dimensions two selected points and reverses with undo/redo', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });

  // Two free points, then leave the tool for selection mode.
  await page.getByRole('button', { name: 'Point', exact: true }).click();
  await clickCanvas(page, canvas, 0.36, 0.4);
  await clickCanvas(page, canvas, 0.6, 0.58);
  await page.getByRole('button', { name: 'Point', exact: true }).click();
  await expect(canvas.locator('.sketch-overlay__point')).toHaveCount(2);

  // Selection-first: select both points, then press D.
  await clickCentre(page, canvas.locator('.sketch-overlay__point').nth(0));
  await clickCentre(page, canvas.locator('.sketch-overlay__point').nth(1));
  await page.keyboard.press('d');

  const editor = page.getByLabel('Dimension value');
  await expect(editor).toBeVisible();
  await editor.fill('30');
  await editor.press('Enter');

  // One distance constraint is recorded; one undo removes it, redo restores it.
  const rows = page.locator('.constraint-list__select');
  await expect(rows).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(rows).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(rows).toHaveCount(1);
});

test('typing d inside a numeric field never activates the Distance tool', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });
  await drawLine(page, canvas);

  // Create a distance dimension so the properties panel shows its numeric field.
  await page.keyboard.press('d');
  await clickCentre(page, canvas.locator('.sketch-overlay__line'));
  await page.getByLabel('Dimension value').fill('40');
  await page.getByLabel('Dimension value').press('Enter');

  // Focus the panel's numeric field and type 'd' — the focus guard must ignore it.
  const field = page.getByLabel('Distance value');
  await field.click();
  await field.press('d');

  // Clicking the line would open the inline editor if the tool had activated; it must not.
  await clickCentre(page, canvas.locator('.sketch-overlay__line'));
  await expect(page.getByLabel('Dimension value')).toHaveCount(0);
});
