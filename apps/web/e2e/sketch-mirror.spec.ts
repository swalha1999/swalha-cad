import type { CadDocumentV2, SketchEntity, SketchFeature } from '@swalha-cad/document';
import { detectSketchProfile } from '@swalha-cad/geometry';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Onshape-parity proof for the sketch Mirror tool, driven end-to-end through the real
// browser UI: mirror half an off-grid profile across a construction centerline that
// shares the profile's two open ends, forming one closed extrudable loop; extrude it and
// verify undo/redo. A second case mirrors a circle and an arc, proving radius preservation
// and arc-direction reversal.
test.use({ viewport: { width: 1440, height: 900 } });

const HEADER_SIZE = 80;
const TRIANGLE_SIZE = 50;

/** Independent binary STL reader (spec-driven, not reused from the exporter under test). */
function parseBinaryStl(bytes: Buffer): { triangleCount: number; maxZ: number; finite: boolean } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangleCount = view.getUint32(HEADER_SIZE, true);
  expect(bytes.byteLength).toBe(HEADER_SIZE + 4 + triangleCount * TRIANGLE_SIZE);
  let maxZ = -Infinity;
  let finite = true;
  let offset = HEADER_SIZE + 4;
  for (let i = 0; i < triangleCount; i++) {
    offset += 12; // facet normal
    for (let v = 0; v < 3; v++) {
      const x = view.getFloat32(offset, true);
      const y = view.getFloat32(offset + 4, true);
      const z = view.getFloat32(offset + 8, true);
      offset += 12;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) finite = false;
      maxZ = Math.max(maxZ, z);
    }
    offset += 2; // attribute byte count
  }
  return { triangleCount, maxZ, finite };
}

async function enterXySketch(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sketch' }).click();
  await page.getByRole('menuitem', { name: 'Top Plane (XY)' }).click();
  await expect(page.getByRole('toolbar', { name: 'Sketch tools' })).toBeVisible();
}

/** Clicks the sketch canvas at an exact plane-local coordinate (mm, y up) by inverting the overlay's screen CTM. */
async function planeClick(page: Page, x: number, y: number): Promise<void> {
  const client = await page.evaluate(
    ([planeX, planeY]) => {
      const svg = document.querySelector('svg.sketch-overlay__svg') as SVGSVGElement | null;
      if (!svg) throw new Error('sketch overlay not found');
      const ctm = svg.getScreenCTM();
      if (!ctm) throw new Error('no screen CTM');
      const point = svg.createSVGPoint();
      point.x = planeX * 4; // PIXELS_PER_UNIT
      point.y = -planeY * 4;
      const c = point.matrixTransform(ctm);
      return { x: c.x, y: c.y };
    },
    [x, y] as const,
  );
  await page.mouse.click(client.x, client.y);
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

function lines(sketch: SketchFeature): Extract<SketchEntity, { kind: 'line' }>[] {
  return sketch.entities.filter((e): e is Extract<SketchEntity, { kind: 'line' }> => e.kind === 'line');
}
function points(sketch: SketchFeature): Extract<SketchEntity, { kind: 'point' }>[] {
  return sketch.entities.filter((e): e is Extract<SketchEntity, { kind: 'point' }> => e.kind === 'point');
}
function circles(sketch: SketchFeature): Extract<SketchEntity, { kind: 'circle' }>[] {
  return sketch.entities.filter((e): e is Extract<SketchEntity, { kind: 'circle' }> => e.kind === 'circle');
}
function arcs(sketch: SketchFeature): Extract<SketchEntity, { kind: 'arc' }>[] {
  return sketch.entities.filter((e): e is Extract<SketchEntity, { kind: 'arc' }> => e.kind === 'arc');
}

// The half-profile's two open ends lie on the vertical centerline x = 10; interior corners are off-grid.
const TOP: [number, number] = [10, 7.4];
const BOTTOM: [number, number] = [10, 46.6];
const MID_A: [number, number] = [43.7, 15.2];
const MID_B: [number, number] = [43.7, 38.8];

test('command-first: mirror half a profile across a construction centerline into a closed extrudable loop', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });

  // Draw the open half-profile chain: TOP → MID_A → MID_B → BOTTOM (both ends on the centerline).
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await planeClick(page, TOP[0], TOP[1]);
  await planeClick(page, MID_A[0], MID_A[1]);
  await planeClick(page, MID_B[0], MID_B[1]);
  await planeClick(page, BOTTOM[0], BOTTOM[1]);
  await page.keyboard.press('Enter'); // finish the chain
  await page.getByRole('button', { name: 'Line', exact: true }).click(); // toggle the tool off
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(3);

  // Draw the construction centerline reusing the two open ends (endpoint snapping fuses onto them).
  await page.getByRole('button', { name: 'Construction' }).click();
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await planeClick(page, TOP[0], TOP[1]);
  await planeClick(page, BOTTOM[0], BOTTOM[1]);
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await page.getByRole('button', { name: 'Construction' }).click(); // back to real geometry
  await expect(canvas.locator('.sketch-overlay__line.sketch-overlay__edge--construction')).toHaveCount(1);

  // Activate Mirror, collect the three profile edges as sources, then choose and pick the axis.
  await page.getByRole('button', { name: 'Mirror', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mirror', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await planeClick(page, 26.85, 11.3); // midpoint of TOP→MID_A
  await planeClick(page, 43.7, 27); // MID_A→MID_B (right edge)
  await planeClick(page, 26.85, 42.7); // MID_B→BOTTOM
  await page.getByRole('button', { name: 'Choose axis' }).click();
  await planeClick(page, 10, 27); // on the centerline, away from the profile edges

  // The live preview appears; confirm it.
  await page.getByRole('button', { name: 'Confirm mirror' }).click();

  // Six real edges now close the mirrored profile (three originals + three reflections).
  await expect(canvas.locator('.sketch-overlay__line:not(.sketch-overlay__edge--construction)')).toHaveCount(6);

  // Undo removes the mirror; redo restores it — proving reversibility.
  await page.keyboard.press('Control+z');
  await expect(canvas.locator('.sketch-overlay__line:not(.sketch-overlay__edge--construction)')).toHaveCount(3);
  await page.keyboard.press('Control+Shift+z');
  await expect(canvas.locator('.sketch-overlay__line:not(.sketch-overlay__edge--construction)')).toHaveCount(6);

  // Persisted geometry: the sources are untouched and a mirrored interior corner sits at the reflected coordinate.
  const sketch = await savedSketch(page);
  expect(lines(sketch).filter((l) => !l.construction)).toHaveLength(6);
  // MID_A (43.7, 15.2) reflects across x = 10 to (-23.7, 15.2); allow for canvas pixel-rounding.
  expect(points(sketch).some((p) => Math.abs(p.x - -23.7) < 0.5 && Math.abs(p.y - 15.2) < 0.5)).toBe(true);
  // The original MID_A corner is still present and unchanged (sources never mutate).
  expect(points(sketch).some((p) => Math.abs(p.x - 43.7) < 0.5 && Math.abs(p.y - 15.2) < 0.5)).toBe(true);
  // The whole outline is one closed profile.
  const profile = detectSketchProfile(sketch);
  expect(profile.ok).toBe(true);

  // Extrude the closed profile into a watertight solid and export a valid STL.
  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await page.getByRole('button', { name: 'Extrude' }).click();
  const dialog = page.getByRole('form', { name: 'Extrude' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Depth').fill('20');
  await dialog.getByRole('button', { name: 'Confirm extrude' }).click();
  await expect(dialog).toHaveCount(0);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export STL', exact: true }).click();
  const stl = parseBinaryStl(await readFile((await (await download).path())!));
  expect(stl.triangleCount).toBeGreaterThan(0);
  expect(stl.finite).toBe(true);
  expect(stl.maxZ).toBeCloseTo(20, 1);
});

test('selection-first: mirror a circle and an arc across a line, preserving radius and reversing arc direction', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });

  // A circle (center (30,20), radius 8) and a 3-point arc, plus a vertical axis line at x = 0.
  await page.getByRole('button', { name: 'Circle', exact: true }).click();
  await planeClick(page, 30, 20);
  await planeClick(page, 38, 20); // radius 8
  await page.getByRole('button', { name: 'Circle', exact: true }).click();

  await page.getByRole('button', { name: 'Arc', exact: true }).click();
  await planeClick(page, 20, 40); // start
  await planeClick(page, 30, 48); // through
  await planeClick(page, 40, 40); // end
  await page.getByRole('button', { name: 'Arc', exact: true }).click();

  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await planeClick(page, 0, -10);
  await planeClick(page, 0, 60);
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Line', exact: true }).click();

  await expect(canvas.locator('.sketch-overlay__circle')).toHaveCount(1);
  await expect(canvas.locator('.sketch-overlay__arc')).toHaveCount(1);

  // Preselect the circle and the arc as sources, plus the single axis line → role inference jumps to confirm.
  await planeClick(page, 38, 20); // on the circle
  await planeClick(page, 30, 48); // on the arc
  await planeClick(page, 0, 25); // on the axis line
  await page.getByRole('button', { name: 'Mirror', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm mirror' }).click();

  // Two circles and two arcs now exist.
  await expect(canvas.locator('.sketch-overlay__circle')).toHaveCount(2);
  await expect(canvas.locator('.sketch-overlay__arc')).toHaveCount(2);

  const sketch = await savedSketch(page);
  const cs = circles(sketch);
  expect(cs).toHaveLength(2);
  // Both circles keep radius 8; the mirror's center is reflected across x = 0 to x ≈ -30.
  expect(cs.every((c) => Math.abs(c.radius - 8) < 0.4)).toBe(true);
  expect(cs.some((c) => Math.abs((points(sketch).find((p) => p.id === c.centerId)!.x) - -30) < 0.5)).toBe(true);
  // The two arcs sweep in opposite directions (reflection reverses orientation).
  const as = arcs(sketch);
  expect(as).toHaveLength(2);
  expect(new Set(as.map((a) => a.direction)).size).toBe(2);
});
