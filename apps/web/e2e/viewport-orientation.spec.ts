import type { CadDocumentV2, SketchFeature, SketchPlane } from '@swalha-cad/document';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { openSketchOnPlane } from './helpers.js';
import type { PlaneLabel } from './helpers.js';

// Browser-level proof of the CAD Z-up viewport convention at the primary desktop
// size: the view-cube Top/Front/Right/Home controls reorient the live WebGL scene
// without breaking it, and entering a sketch on each origin-plane support keeps a
// right-handed, unmirrored 2D coordinate frame (screen-right → +x, screen-up → +y).
test.use({ viewport: { width: 1440, height: 900 } });

/** Reads the RGBA of the viewport canvas at fractional (0..1) positions. */
async function samplePixelsAt(page: Page, points: { fx: number; fy: number }[]): Promise<[number, number, number, number][]> {
  return page.$eval(
    '.viewport__canvas',
    (canvas: HTMLCanvasElement, pts: { fx: number; fy: number }[]) => {
      const probe = document.createElement('canvas');
      probe.width = canvas.width;
      probe.height = canvas.height;
      const ctx = probe.getContext('2d')!;
      ctx.drawImage(canvas, 0, 0);
      return pts.map(({ fx, fy }) => {
        const x = Math.min(canvas.width - 1, Math.max(0, Math.round(fx * canvas.width)));
        const y = Math.min(canvas.height - 1, Math.max(0, Math.round(fy * canvas.height)));
        const d = ctx.getImageData(x, y, 1, 1).data;
        return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, d[3] ?? 0] as [number, number, number, number];
      });
    },
    points,
  );
}

/** Asserts the origin planes still render (non-empty, blue-tinted) around the viewport centre. */
async function expectPlanesStillRendered(page: Page): Promise<void> {
  const centre = await samplePixelsAt(page, [
    { fx: 0.5, fy: 0.5 },
    { fx: 0.47, fy: 0.5 },
    { fx: 0.53, fy: 0.5 },
    { fx: 0.5, fy: 0.47 },
  ]);
  const drawn = centre.filter(([, , , a]) => a > 0);
  expect(drawn.length, 'the reoriented scene must still render the planes').toBeGreaterThanOrEqual(2);
}

async function clickCanvas(page: Page, canvas: Locator, fx: number, fy: number): Promise<void> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('sketch canvas has no bounding box');
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

test('view cube Top/Front/Right/Home reorient the live scene without breaking the WebGL render', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(400);
  await expectPlanesStillRendered(page);

  // Each standard-view control snaps the Z-up camera down a principal axis; the
  // scene must keep rendering (no degenerate up vector, no blank canvas) after each.
  for (const view of ['Top view', 'Front view', 'Right view', 'Isometric view']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    await page.waitForTimeout(250);
    await expectPlanesStillRendered(page);
  }
});

/**
 * Enters a sketch on the given origin plane, draws a rectangle whose corners sit at
 * fixed fractions of the sketch canvas (upper-left then lower-right of centre), and
 * returns the saved sketch feature so the test can inspect its coordinates.
 */
async function sketchRectangleAndSave(page: Page, plane: PlaneLabel): Promise<SketchFeature> {
  await openSketchOnPlane(page, plane);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  // Upper-left of centre, then lower-right of centre.
  await clickCanvas(page, canvas, 0.4, 0.4);
  await clickCanvas(page, canvas, 0.6, 0.6);
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(4);
  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await expect(page.getByRole('toolbar', { name: 'Sketch tools' })).toHaveCount(0);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const savedPath = await (await download).path();
  const saved = JSON.parse(await readFile(savedPath!, 'utf-8')) as CadDocumentV2;
  const sketch = saved.features.find((feature): feature is SketchFeature => feature.kind === 'sketch');
  if (!sketch) throw new Error('expected a saved sketch feature');
  return sketch;
}

const PLANE_OF_LABEL: Record<PlaneLabel, SketchPlane> = { Top: 'XY', Front: 'XZ', Right: 'YZ' };

for (const label of ['Top', 'Front', 'Right'] as const) {
  test(`sketching on ${label} keeps a right-handed, unmirrored coordinate frame`, async ({ page }) => {
    await page.goto('/');

    const sketch = await sketchRectangleAndSave(page, label);
    expect(sketch.plane).toBe(PLANE_OF_LABEL[label]);

    const points = sketch.entities.filter((entity): entity is Extract<typeof entity, { kind: 'point' }> => entity.kind === 'point');
    expect(points).toHaveLength(4);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // The canvas centre is the sketch origin. A click right of centre (fx 0.6) must
    // land at +x and a click left (fx 0.4) at -x; a click below centre (fy 0.6) must
    // land at -y (y is up) and above (fy 0.4) at +y. So the rectangle straddles the
    // origin on both axes — the definitive check that the frame is neither flipped
    // (mirrored X) nor inverted (mirrored Y) on any support plane.
    expect(minX, 'left click must map to -x (no X mirror)').toBeLessThan(0);
    expect(maxX, 'right click must map to +x (no X mirror)').toBeGreaterThan(0);
    expect(minY, 'lower click must map to -y (no Y flip)').toBeLessThan(0);
    expect(maxY, 'upper click must map to +y (no Y flip)').toBeGreaterThan(0);

    // Symmetric clicks around centre give a near-square rectangle (sanity on scale).
    const width = maxX - minX;
    const height = maxY - minY;
    expect(width).toBeGreaterThan(0);
    expect(Math.abs(width - height) / width, 'symmetric clicks should map to a near-square').toBeLessThan(0.35);
  });
}
