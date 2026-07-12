import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

/**
 * Reads the RGBA of a canvas pixel, offset from center, to prove the body underneath
 * isn't rendering as flat black/empty. The default seed document's cylinder sits at
 * the world origin (canvas center); an offset lets tests sample its body while
 * avoiding the transform gizmo that overlays the exact center once it is selected.
 */
async function samplePixel(
  canvasSelector: string,
  page: import('@playwright/test').Page,
  offset: { dx: number; dy: number } = { dx: 0, dy: 0 },
): Promise<[number, number, number, number]> {
  return page.$eval(
    canvasSelector,
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

test.describe('Part Studio shell at 1440x900', () => {
  test('renders the two-level toolbar, feature tree, viewport overlays, properties panel, and status bar without overlap', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page.getByText('SWALHA CAD')).toBeVisible();
    await expect(page.getByRole('toolbar', { name: 'Feature toolbar' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Scene tree' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Properties' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'View orientation' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Viewport navigation' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Part Studio 1' })).toBeVisible();

    // The document bar and feature toolbar must stack, not overlap.
    const documentBarBox = await page.locator('.document-bar').boundingBox();
    const featureToolbarBox = await page.locator('.feature-toolbar').boundingBox();
    expect(documentBarBox).not.toBeNull();
    expect(featureToolbarBox).not.toBeNull();
    expect(featureToolbarBox!.y).toBeGreaterThanOrEqual(documentBarBox!.y + documentBarBox!.height - 1);

    // The status bar sits at the very bottom of the 900px-tall viewport.
    const statusBarBox = await page.locator('.status-bar').boundingBox();
    expect(statusBarBox!.y + statusBarBox!.height).toBeCloseTo(900, 0);
  });

  /**
   * Adds a cylinder at the world origin, then deselects it with an empty
   * left-center viewport click — away from the centred body and from the
   * top-right view cube / bottom-left navigation overlays (which would orbit).
   */
  async function addCylinderDeselected(page: import('@playwright/test').Page): Promise<void> {
    await page.getByRole('button', { name: 'Add Cylinder' }).click();
    const box = (await page.locator('.viewport__canvas').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.5);
    await page.waitForTimeout(200);
  }

  test('shows visibly lit, non-black bodies with no selection', async ({ page }) => {
    await page.goto('/');
    await addCylinderDeselected(page);
    await page.waitForTimeout(300);

    const [r, g, b, a] = await samplePixel('.viewport__canvas', page);
    // The cylinder sits at the world origin, which projects to the canvas
    // center; its lit MeshStandardMaterial must not render as black/empty.
    expect(a).toBeGreaterThan(0);
    expect(r + g + b).toBeGreaterThan(60);
    expect(r === 0 && g === 0 && b === 0).toBe(false);
  });

  test('highlights a selected body with the SWALHA blue accent', async ({ page }) => {
    await page.goto('/');
    await addCylinderDeselected(page);
    await page.waitForTimeout(300);
    // Offset below the object's center to avoid the transform gizmo that will overlay it once selected.
    const offset = { dx: 0, dy: 60 };
    const unselected = await samplePixel('.viewport__canvas', page, offset);

    await page.getByRole('navigation', { name: 'Scene tree' }).getByRole('button', { name: 'Cylinder' }).click();
    await page.waitForTimeout(300);
    const selected = await samplePixel('.viewport__canvas', page, offset);

    // Selection adds a SWALHA-blue emissive highlight, so the center pixel's blue
    // channel should gain far more than its red channel gains.
    expect(selected).not.toEqual(unselected);
    const redDelta = selected[0] - unselected[0];
    const blueDelta = selected[2] - unselected[2];
    expect(blueDelta).toBeGreaterThan(redDelta);
  });
});
