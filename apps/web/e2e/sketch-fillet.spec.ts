import type { CadDocumentV2, SketchEntity, SketchFeature } from '@swalha-cad/document';
import { detectSketchProfile } from '@swalha-cad/geometry';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openSketchOnPlane } from './helpers.js';

// Onshape-parity proof for the sketch Fillet tool, driven end-to-end through the real
// browser UI: round a rectangle corner to a typed 7.5 mm radius at arbitrary (off-grid)
// coordinates, extrude the rounded profile, and verify undo/redo — via both the
// command-first (pick two lines) and selection-first (preselect two lines) workflows.
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
  await openSketchOnPlane(page, 'Top');
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

function arcs(sketch: SketchFeature): Extract<SketchEntity, { kind: 'arc' }>[] {
  return sketch.entities.filter((e): e is Extract<SketchEntity, { kind: 'arc' }> => e.kind === 'arc');
}
function points(sketch: SketchFeature): Extract<SketchEntity, { kind: 'point' }>[] {
  return sketch.entities.filter((e): e is Extract<SketchEntity, { kind: 'point' }> => e.kind === 'point');
}

/** Draws a rectangle at arbitrary off-grid corners via the Rectangle tool, then leaves the tool. */
async function drawRectangle(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await planeClick(page, 7.3, 5.1); // bottom-left corner (off grid, non-zero origin)
  await planeClick(page, 70.7, 46.8); // top-right corner
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click(); // toggle tool off
  await expect(page.getByRole('img', { name: 'Sketch canvas' }).locator('.sketch-overlay__line')).toHaveCount(4);
}

test('command-first: round a rectangle corner to a typed 7.5 mm radius, extrude, and undo/redo', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);
  await drawRectangle(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });

  // Activate the Fillet tool from the Modify group and pick the two edges of the bottom-left corner.
  await page.getByRole('button', { name: 'Fillet' }).click();
  await expect(page.getByRole('button', { name: 'Fillet' })).toHaveAttribute('aria-pressed', 'true');
  await planeClick(page, 40, 5.1); // bottom edge, away from the corner
  await planeClick(page, 7.3, 25); // left edge, away from the corner

  // The inline radius editor opens; type the exact 7.5 mm radius and commit.
  const editor = page.getByLabel('Fillet radius');
  await expect(editor).toBeVisible();
  await editor.fill('7.5');
  await editor.press('Enter');

  // Exactly one arc now rounds the corner.
  await expect(canvas.locator('.sketch-overlay__arc')).toHaveCount(1);

  // Undo removes the fillet (sharp corner again); redo restores it — proving reversibility.
  await page.keyboard.press('Control+z');
  await expect(canvas.locator('.sketch-overlay__arc')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(canvas.locator('.sketch-overlay__arc')).toHaveCount(1);

  // Save and verify the persisted geometry: a 7.5 mm arc, the sharp corner point gone.
  const sketch = await savedSketch(page);
  const as = arcs(sketch);
  expect(as).toHaveLength(1);
  expect(as[0]!.radius).toBeCloseTo(7.5, 6);
  // The original sharp corner near (7.3, 5.1) has been trimmed away (no point within a fillet radius of it).
  expect(points(sketch).some((p) => Math.hypot(p.x - 7.3, p.y - 5.1) < 5)).toBe(false);
  // Tangent points sit ~7.5 mm along each edge from the corner (loose tolerance: the drawn
  // corner is subject to pixel-rounding from the canvas click, so both accumulate ~0.2 mm).
  expect(points(sketch).some((p) => Math.abs(p.x - 14.8) < 0.4 && Math.abs(p.y - 5.1) < 0.4)).toBe(true);
  expect(points(sketch).some((p) => Math.abs(p.x - 7.3) < 0.4 && Math.abs(p.y - 12.6) < 0.4)).toBe(true);
  // The rounded outline is a single watertight curve-loop profile.
  const profile = detectSketchProfile(sketch);
  expect(profile.ok).toBe(true);
  if (profile.ok) expect(profile.profile.kind).toBe('curve-loop');

  // Extrude the rounded profile into a watertight solid and export a valid STL.
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

test('selection-first: preselect two edges, then Fillet applies a typed radius', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);
  await drawRectangle(page);
  const canvas = page.getByRole('img', { name: 'Sketch canvas' });

  // Preselect the two edges of the top-right corner (top edge and right edge) in selection mode.
  await planeClick(page, 40, 46.8); // top edge, mid-span
  await planeClick(page, 70.7, 25); // right edge, mid-span
  await expect(canvas.locator('.sketch-overlay__selected')).toHaveCount(2);

  // Activating Fillet with two lines selected jumps straight to the radius editor.
  await page.getByRole('button', { name: 'Fillet' }).click();
  const editor = page.getByLabel('Fillet radius');
  await expect(editor).toBeVisible();
  await editor.fill('7.5');
  await editor.press('Enter');

  await expect(canvas.locator('.sketch-overlay__arc')).toHaveCount(1);

  const sketch = await savedSketch(page);
  const as = arcs(sketch);
  expect(as).toHaveLength(1);
  expect(as[0]!.radius).toBeCloseTo(7.5, 6);
  // The top-right corner (70.7, 46.8) is trimmed away.
  expect(points(sketch).some((p) => Math.abs(p.x - 70.7) < 1e-6 && Math.abs(p.y - 46.8) < 1e-6)).toBe(false);
  const profile = detectSketchProfile(sketch);
  expect(profile.ok).toBe(true);
  if (profile.ok) expect(profile.profile.kind).toBe('curve-loop');
});

test('Fillet stays active for repeated fillets and Escape exits the tool', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);

  await page.getByRole('button', { name: 'Fillet' }).click();
  expect(await page.getByRole('button', { name: 'Fillet' }).getAttribute('aria-pressed')).toBe('true');
  // With no picks yet, one Escape exits the tool.
  await page.keyboard.press('Escape');
  expect(await page.getByRole('button', { name: 'Fillet' }).getAttribute('aria-pressed')).toBe('false');
});
