import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { openSketchOnPlane } from './helpers.js';

// End-to-end proof of the startup workspace + Sketch support-selection UX at the
// primary 1440x900 desktop size: a demo-free fresh Part Studio, the nonblocking
// support-selection command (banner + task panel + draft row), plane and planar-
// face support selection, the preselect-then-Sketch fast path, and a neutral
// cancel that mutates nothing.
test.use({ viewport: { width: 1440, height: 900 } });

const tree = (page: Page) => page.getByRole('navigation', { name: 'Scene tree' });
const banner = (page: Page) => page.getByRole('status', { name: 'Select a sketch plane or planar face' });
const supportPanel = (page: Page) => page.getByRole('form', { name: 'Sketch' });
const sketchTools = (page: Page) => page.getByRole('toolbar', { name: 'Sketch tools' });
const viewportCanvas = (page: Page) => page.locator('canvas.viewport__canvas');
const sketchCanvas = (page: Page) => page.getByRole('img', { name: 'Sketch canvas' });

async function clickFraction(page: Page, target: Locator, fx: number, fy: number): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('target has no bounding box');
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

/** Builds a solid box centred on the world origin (symmetric-extruded rectangle) to expose planar faces. */
async function buildSymmetricBox(page: Page): Promise<void> {
  await openSketchOnPlane(page, 'Top');
  const canvas = sketchCanvas(page);
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await clickFraction(page, canvas, 0.36, 0.4);
  await clickFraction(page, canvas, 0.64, 0.6);
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(4);
  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await expect(sketchTools(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  const dialog = page.getByRole('form', { name: 'Extrude' });
  await dialog.getByRole('button', { name: 'Symmetric' }).click();
  await dialog.getByLabel('Depth').fill('40');
  await dialog.getByRole('button', { name: 'Confirm extrude' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(tree(page).getByRole('button', { name: 'Extrude 1' })).toBeVisible();
}

test('fresh startup: demo-free workspace with Default geometry and Parts (0)', async ({ page }) => {
  await page.goto('/');

  const t = tree(page);
  await expect(t.getByText('Default geometry')).toBeVisible();
  await expect(t.getByText('Origin')).toBeVisible();
  await expect(t.getByRole('button', { name: 'Top', exact: true })).toBeVisible();
  await expect(t.getByRole('button', { name: 'Front', exact: true })).toBeVisible();
  await expect(t.getByRole('button', { name: 'Right', exact: true })).toBeVisible();
  await expect(t.getByText('Parts (0)')).toBeVisible();

  // Nothing demo-like is present, and no support command is active at rest.
  await expect(t.getByRole('button', { name: 'Box' })).toHaveCount(0);
  await expect(banner(page)).toHaveCount(0);
  await expect(supportPanel(page)).toHaveCount(0);
});

test('Sketch with no preselection opens the command, then Top + confirm enters the sketch', async ({ page }) => {
  await page.goto('/');
  const t = tree(page);

  await page.getByRole('button', { name: 'Sketch', exact: true }).click();

  // The nonblocking command state: banner, task panel, active draft row, disabled create.
  await expect(banner(page)).toBeVisible();
  await expect(supportPanel(page)).toBeVisible();
  await expect(t.getByText('Sketch 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create sketch' })).toBeDisabled();
  // No XY sketch was silently created and no drawing tools are present yet.
  await expect(sketchTools(page)).toHaveCount(0);

  // Choose the Top plane: the collector fills and creation unlocks.
  await t.getByRole('button', { name: 'Top', exact: true }).click();
  await expect(supportPanel(page).getByText('Top plane')).toBeVisible();
  const create = page.getByRole('button', { name: 'Create sketch' });
  await expect(create).toBeEnabled();

  await create.click();
  await expect(sketchTools(page)).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});

test('Sketch then select a planar solid face confirms into a face sketch', async ({ page }) => {
  await page.goto('/');
  await buildSymmetricBox(page);

  // The +Z top cap faces the front orthographic camera at the canvas centre.
  await page.getByRole('button', { name: 'Orthographic' }).click();
  await page.getByRole('button', { name: 'Front view' }).click();

  await page.getByRole('button', { name: 'Sketch', exact: true }).click();
  await expect(banner(page)).toBeVisible();
  await clickFraction(page, viewportCanvas(page), 0.5, 0.5);
  await expect(supportPanel(page).getByText('Planar face')).toBeVisible();
  await page.getByRole('button', { name: 'Create sketch' }).click();

  await expect(sketchTools(page)).toBeVisible();
  await expect(tree(page).getByRole('button', { name: 'Sketch 2' })).toBeVisible();
});

test('preselecting a planar face then Sketch enters immediately (no command)', async ({ page }) => {
  await page.goto('/');
  await buildSymmetricBox(page);
  await page.getByRole('button', { name: 'Orthographic' }).click();
  await page.getByRole('button', { name: 'Front view' }).click();

  // Preselect the face in the viewport, then the single Sketch action enters directly.
  await clickFraction(page, viewportCanvas(page), 0.5, 0.5);
  await page.getByRole('button', { name: 'Sketch', exact: true }).click();

  await expect(banner(page)).toHaveCount(0);
  await expect(sketchTools(page)).toBeVisible();
});

test('cancelling the command with Escape creates no feature and leaves history neutral', async ({ page }) => {
  await page.goto('/');
  const t = tree(page);

  await page.getByRole('button', { name: 'Sketch', exact: true }).click();
  await t.getByRole('button', { name: 'Top', exact: true }).click();
  await expect(supportPanel(page).getByText('Top plane')).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(supportPanel(page)).toHaveCount(0);
  await expect(banner(page)).toHaveCount(0);
  await expect(sketchTools(page)).toHaveCount(0);
  // No sketch feature, Parts still empty, and nothing was pushed onto the undo history.
  await expect(t.getByText('Parts (0)')).toBeVisible();
  await expect(t.getByRole('button', { name: 'Sketch 1' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('an empty-space click during the command does not silently choose a plane', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Sketch', exact: true }).click();
  // Click a far viewport corner that misses every plane and body.
  await clickFraction(page, viewportCanvas(page), 0.97, 0.04);

  // The collector stays empty, the command stays open, and creation stays blocked.
  await expect(supportPanel(page).getByText('Select a plane or planar face')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create sketch' })).toBeDisabled();
  await expect(sketchTools(page)).toHaveCount(0);
});
