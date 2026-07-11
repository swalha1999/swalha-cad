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

async function enterXySketch(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sketch' }).click();
  await page.getByRole('menuitem', { name: 'Top Plane (XY)' }).click();
  await expect(page.getByRole('toolbar', { name: 'Sketch tools' })).toBeVisible();
}

test('creates an XY sketch, draws a rectangle and circle, finishes, and persists across save/reload', async ({ page }) => {
  await page.goto('/');

  await enterXySketch(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });

  // Rectangle: two opposite corners.
  await page.getByRole('button', { name: 'Rectangle' }).click();
  await clickCanvas(page, canvas, 0.35, 0.4);
  await clickCanvas(page, canvas, 0.62, 0.62);
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(4);

  // Circle: center then rim.
  await page.getByRole('button', { name: 'Circle' }).click();
  await clickCanvas(page, canvas, 0.5, 0.35);
  await clickCanvas(page, canvas, 0.58, 0.35);
  await expect(canvas.locator('.sketch-overlay__circle')).toHaveCount(1);

  // Finish returns to the Part Studio, preserving the feature in the tree.
  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await expect(page.getByRole('toolbar', { name: 'Sketch tools' })).toHaveCount(0);
  const sceneTree = page.getByRole('navigation', { name: 'Scene tree' });
  await expect(sceneTree.getByText('Sketch 1')).toBeVisible();

  // Save the document and confirm the sketch feature round-trips to disk.
  const saveDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const savedPath = await (await saveDownload).path();
  expect(savedPath).toBeTruthy();

  const saved = JSON.parse(await readFile(savedPath!, 'utf-8')) as CadDocumentV2;
  expect(saved.schemaVersion).toBe(2);
  const savedSketch = saved.features.find((feature): feature is SketchFeature => feature.kind === 'sketch');
  expect(savedSketch).toBeDefined();
  expect(savedSketch?.plane).toBe('XY');
  expect(savedSketch?.entities.filter((entity) => entity.kind === 'line')).toHaveLength(4);
  expect(savedSketch?.entities.filter((entity) => entity.kind === 'circle')).toHaveLength(1);

  // A fresh reload starts from the seed document with no sketch feature.
  await page.reload();
  await expect(sceneTree.getByText('Sketch 1')).toHaveCount(0);

  // Re-opening the saved file restores the sketch feature into the tree.
  await page.locator('input[type="file"]').setInputFiles(savedPath!);
  await expect(sceneTree.getByText('Sketch 1')).toBeVisible();
});

test('cancels the active tool step with Escape without committing geometry', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });

  await page.getByRole('button', { name: 'Rectangle' }).click();
  await clickCanvas(page, canvas, 0.4, 0.4); // first corner placed, pending
  await page.keyboard.press('Escape');
  await clickCanvas(page, canvas, 0.6, 0.6); // would-be second corner, but the step was cancelled

  // No rectangle was committed because Escape dropped the pending first corner.
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(0);
});
