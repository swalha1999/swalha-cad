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

// Rectangle edges are rendered in construction order: top, right, bottom, left.
const EDGES = { top: 0, right: 1, bottom: 2, left: 3 } as const;

async function drawRectangle(page: Page, canvas: Locator): Promise<void> {
  await page.getByRole('button', { name: 'Rectangle' }).click();
  await clickCanvas(page, canvas, 0.35, 0.4);
  await clickCanvas(page, canvas, 0.62, 0.62);
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(4);
  // Toggle the rectangle tool off so the canvas enters selection mode.
  await page.getByRole('button', { name: 'Rectangle' }).click();
}

/** Selects a rectangle edge by clicking the centre of its rendered line. */
async function selectEdge(page: Page, canvas: Locator, edge: keyof typeof EDGES): Promise<void> {
  const box = await canvas.locator('.sketch-overlay__line').nth(EDGES[edge]).boundingBox();
  if (!box) throw new Error(`edge ${edge} has no bounding box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function applyConstraint(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `${name} constraint`, exact: true }).click();
}

test('sketches and dimensions a rectangle to a fully constrained state with working undo/redo', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });
  await drawRectangle(page, canvas);

  const geometry = canvas.locator('.sketch-overlay__geometry');
  await expect(geometry).toHaveClass(/sketch-overlay__geometry--under-constrained/);

  // Constrain orientation: top/bottom horizontal, left/right vertical.
  await selectEdge(page, canvas, 'top');
  await applyConstraint(page, 'Horizontal');
  await selectEdge(page, canvas, 'right');
  await applyConstraint(page, 'Vertical');
  await selectEdge(page, canvas, 'bottom');
  await applyConstraint(page, 'Horizontal');
  await selectEdge(page, canvas, 'left');
  await applyConstraint(page, 'Vertical');

  // Dimension two adjacent sides to remove the remaining degrees of freedom.
  await selectEdge(page, canvas, 'top');
  await applyConstraint(page, 'Distance');
  await selectEdge(page, canvas, 'right');
  await applyConstraint(page, 'Distance');

  // Fully constrained: geometry renders dark and the status is reported in the panel and status bar.
  await expect(geometry).toHaveClass(/sketch-overlay__geometry--fully-constrained/);
  await expect(page.locator('.constraint-status--fully-constrained')).toBeVisible();
  await expect(page.locator('.status-bar__solve--fully-constrained')).toBeVisible();

  // Undo drops the last dimension, relaxing the sketch back to under-constrained.
  await page.keyboard.press('Control+z');
  await expect(geometry).toHaveClass(/sketch-overlay__geometry--under-constrained/);

  // Redo restores the dimension and the fully constrained state.
  await page.keyboard.press('Control+Shift+z');
  await expect(geometry).toHaveClass(/sketch-overlay__geometry--fully-constrained/);
});

test('rejects a contradictory constraint visibly and recovers on undo', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });
  await drawRectangle(page, canvas);

  const geometry = canvas.locator('.sketch-overlay__geometry');

  // Fix the top edge's length, then demand it be both horizontal and vertical:
  // a non-zero-length segment cannot be both, so the system is contradictory.
  await selectEdge(page, canvas, 'top');
  await applyConstraint(page, 'Distance');
  await selectEdge(page, canvas, 'top');
  await applyConstraint(page, 'Horizontal');
  await selectEdge(page, canvas, 'top');
  await applyConstraint(page, 'Vertical');

  // The conflict is visible: geometry turns red, the status is Conflicting, and an alert explains it.
  await expect(geometry).toHaveClass(/sketch-overlay__geometry--conflicting/);
  await expect(page.locator('.constraint-status--conflicting')).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.status-bar__solve--conflicting')).toBeVisible();

  // Undo removes the offending constraint and clears the conflict without corrupting the geometry.
  await page.keyboard.press('Control+z');
  await expect(geometry).not.toHaveClass(/sketch-overlay__geometry--conflicting/);
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(4);
});
