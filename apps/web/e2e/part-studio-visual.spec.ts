import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { openSketchOnPlane } from './helpers.js';

// Visual + layout release gate for the Onshape-inspired Part Studio at the primary
// 1440x900 desktop size. The non-deterministic WebGL viewport canvas is hidden in
// every screenshot (its deterministic CSS gradient background shows through) so the
// committed baselines diff only the stable DOM chrome — toolbars, feature tree,
// panels, overlays, and status bar — while all of it stays visible. The 3D render
// itself is asserted separately via canvas pixel sampling in this same file.
test.use({ viewport: { width: 1440, height: 900 } });

/**
 * Hides the WebGL canvas (keeping layout intact) so screenshots are deterministic
 * across GPUs/machines while every DOM overlay stacked above the viewport — the
 * sketch toolbar, sketch overlay, extrude preview, view cube — stays visible.
 */
async function hideViewport(page: Page): Promise<void> {
  await page.addStyleTag({ content: '.viewport__canvas { visibility: hidden !important; }' });
}

async function clickCanvas(page: Page, canvas: Locator, fx: number, fy: number): Promise<void> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('sketch canvas has no bounding box');
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

/**
 * Samples a viewport canvas pixel (offset from center) to prove the body underneath
 * is lit rather than rendering as flat black/empty. The seed cylinder sits at the
 * world origin, which projects to the canvas center.
 */
async function samplePixel(page: Page, offset: { dx: number; dy: number } = { dx: 0, dy: 0 }): Promise<[number, number, number, number]> {
  return page.$eval(
    '.viewport__canvas',
    (canvas: HTMLCanvasElement, { dx, dy }: { dx: number; dy: number }) => {
      const probe = document.createElement('canvas');
      probe.width = canvas.width;
      probe.height = canvas.height;
      const ctx = probe.getContext('2d')!;
      ctx.drawImage(canvas, 0, 0);
      const data = ctx.getImageData(Math.floor(canvas.width / 2) + dx, Math.floor(canvas.height / 2) + dy, 1, 1).data;
      return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0];
    },
    offset,
  );
}

/** Asserts two axis-aligned boxes do not overlap (a small epsilon tolerates shared borders). */
function expectNoOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): void {
  const disjoint = a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1;
  expect(disjoint, 'expected the two regions not to overlap').toBe(true);
}

test.describe('Part Studio visual regression at 1440x900', () => {
  test('normal Part Studio: chrome laid out without overlap or overflow', async ({ page }) => {
    await page.goto('/');

    // Every structural region of the professional CAD shell is present.
    await expect(page.getByText('SWALHA CAD')).toBeVisible();
    await expect(page.getByRole('toolbar', { name: 'Feature toolbar' })).toBeVisible();
    const tree = page.getByRole('navigation', { name: 'Scene tree' });
    const properties = page.getByRole('complementary', { name: 'Properties' });
    const viewCube = page.getByRole('group', { name: 'View orientation' });
    const nav = page.getByRole('group', { name: 'Viewport navigation' });
    const statusBar = page.locator('.status-bar');
    await expect(tree).toBeVisible();
    await expect(properties).toBeVisible();
    await expect(viewCube).toBeVisible();
    await expect(nav).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Part Studio 1' })).toBeVisible();

    // The two top bars stack rather than overlap.
    const documentBarBox = (await page.locator('.document-bar').boundingBox())!;
    const featureToolbarBox = (await page.locator('.feature-toolbar').boundingBox())!;
    expect(featureToolbarBox.y).toBeGreaterThanOrEqual(documentBarBox.y + documentBarBox.height - 1);

    // The left tree and right properties panel are readable (non-trivial width) and do not overlap.
    const treeBox = (await tree.boundingBox())!;
    const propsBox = (await properties.boundingBox())!;
    expect(treeBox.width).toBeGreaterThan(180);
    expect(propsBox.width).toBeGreaterThan(200);
    expectNoOverlap(treeBox, propsBox);

    // The status bar spans the very bottom of the 900px-tall window.
    const statusBox = (await statusBar.boundingBox())!;
    expect(statusBox.y + statusBox.height).toBeCloseTo(900, 0);
    expectNoOverlap(featureToolbarBox, statusBox);

    // No horizontal document overflow: the layout fits the desktop width exactly.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await hideViewport(page);
    await expect(page).toHaveScreenshot('part-studio.png');
  });

  test('added bodies render lit (unselected) and gain a blue highlight when selected', async ({ page }) => {
    await page.goto('/');
    // A fresh Part Studio is demo-free: add a body at the origin, then deselect it
    // with an empty left-center click (clear of the centred body and the overlays).
    await page.getByRole('button', { name: 'Add Cylinder' }).click();
    const box = (await page.locator('.viewport__canvas').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.5);
    await page.waitForTimeout(300);

    // Unselected: the origin cylinder must be visibly lit, never flat black/empty.
    const offset = { dx: 0, dy: 60 };
    const unselected = await samplePixel(page, offset);
    expect(unselected[3]).toBeGreaterThan(0);
    expect(unselected[0] + unselected[1] + unselected[2]).toBeGreaterThan(60);
    expect(unselected[0] === 0 && unselected[1] === 0 && unselected[2] === 0).toBe(false);

    // Selecting the body adds a SWALHA-blue highlight: blue channel gains more than red.
    await page.getByRole('navigation', { name: 'Scene tree' }).getByRole('button', { name: 'Cylinder' }).click();
    await page.waitForTimeout(300);
    const selected = await samplePixel(page, offset);
    expect(selected).not.toEqual(unselected);
    expect(selected[2] - unselected[2]).toBeGreaterThan(selected[0] - unselected[0]);
  });

  test('sketch mode: the expanded grouped tool toolbar is laid out cleanly', async ({ page }) => {
    await page.goto('/');
    await openSketchOnPlane(page, 'Top');

    const toolbar = page.getByRole('toolbar', { name: 'Sketch tools' });
    await expect(toolbar).toBeVisible();
    // The dense toolbar is organised into named groups plus the constraints toolbar.
    await expect(toolbar.getByRole('group', { name: 'Create' })).toBeVisible();
    await expect(toolbar.getByRole('group', { name: 'Polygon' })).toBeVisible();
    await expect(page.getByRole('toolbar', { name: 'Constraints' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Finish Sketch' })).toBeVisible();

    // The expanded toolbar stays on its own row above the sketch canvas without overlap.
    const toolbarBox = (await toolbar.boundingBox())!;
    const canvasBox = (await page.getByRole('img', { name: 'Sketch canvas' }).boundingBox())!;
    expectNoOverlap(toolbarBox, canvasBox);
    expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(1440 + 1);

    await hideViewport(page);
    await expect(page).toHaveScreenshot('sketch-mode.png');
  });

  test('extrusion task: the depth panel and live preview overlay read clearly', async ({ page }) => {
    await page.goto('/');

    // Build a quick constrained-enough profile and finish the sketch.
    await openSketchOnPlane(page, 'Top');
    const canvas = page.getByRole('img', { name: 'Sketch canvas' });
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await clickCanvas(page, canvas, 0.35, 0.4);
    await clickCanvas(page, canvas, 0.62, 0.62);
    await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(4);
    await page.getByRole('button', { name: 'Finish Sketch' }).click();

    // Open the extrude task: the right panel becomes the depth form and the preview overlay appears.
    await page.getByRole('button', { name: 'Extrude' }).click();
    const dialog = page.getByRole('form', { name: 'Extrude' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Depth').fill('30');
    const preview = page.locator('.extrude-preview');
    await expect(preview).toBeVisible();
    await expect(preview.locator('.extrude-preview__value')).toHaveText(/30 mm/);

    // The task panel is readable and does not overlap the live-preview overlay.
    const dialogBox = (await dialog.boundingBox())!;
    const previewBox = (await preview.locator('.extrude-preview__handle').boundingBox())!;
    expect(dialogBox.width).toBeGreaterThan(200);
    expectNoOverlap(dialogBox, previewBox);

    await hideViewport(page);
    await expect(page).toHaveScreenshot('extrude-task.png');
  });

  test('responsive minimum desktop: layout holds at 1280x800 without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    // All primary regions remain visible at the smaller supported desktop size.
    await expect(page.getByRole('toolbar', { name: 'Feature toolbar' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Scene tree' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Properties' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'View orientation' })).toBeVisible();

    const statusBox = (await page.locator('.status-bar').boundingBox())!;
    expect(statusBox.y + statusBox.height).toBeCloseTo(800, 0);

    // No horizontal overflow at the minimum desktop width.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
