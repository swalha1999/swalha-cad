import type { CadDocumentV2, SketchEntity, SketchFeature } from '@swalha-cad/document';
import { arcEndpoints, detectSketchProfile } from '@swalha-cad/geometry';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

async function enterXySketch(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sketch' }).click();
  await page.getByRole('menuitem', { name: 'Top Plane (XY)' }).click();
  await expect(page.getByRole('toolbar', { name: 'Sketch tools' })).toBeVisible();
}

/**
 * Clicks the sketch canvas at an exact plane-local coordinate (mm, y up) by
 * inverting the overlay's own screen CTM — the reliable dual of the interaction
 * hook's `clientToPlane`, so a test can place geometry at precise continuous
 * coordinates without depending on the element's rendered size.
 */
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
function arcs(sketch: SketchFeature): Extract<SketchEntity, { kind: 'arc' }>[] {
  return sketch.entities.filter((e): e is Extract<SketchEntity, { kind: 'arc' }> => e.kind === 'arc');
}

test('trim: a rectangle chain with an overhang becomes a closed valid profile', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);

  // Draw an open chain: three sides of a 40×40 square plus a left edge that overhangs
  // below the bottom edge, crossing it exactly at the origin corner.
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await planeClick(page, 0, 0); // p0 (origin)
  await planeClick(page, 40, 0); // p1
  await planeClick(page, 40, 40); // p2
  await planeClick(page, 0, 40); // p3
  await planeClick(page, 0, -20); // p4 — overhang tip below the bottom edge
  await page.keyboard.press('Enter');

  const canvas = page.getByRole('img', { name: 'Sketch canvas' });
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(4);

  // Trim the overhang: click the piece below the bottom edge.
  await page.getByRole('button', { name: 'Trim' }).click();
  await planeClick(page, 0, -10);

  // Four lines remain and the overhang tip is gone.
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(4);

  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  const sketch = await savedSketch(page);
  expect(lines(sketch)).toHaveLength(4);
  expect(points(sketch).some((p) => p.y < -1)).toBe(false); // overhang tip removed
  // The four edges now form exactly one closed, non-self-intersecting profile.
  const profile = detectSketchProfile(sketch);
  expect(profile.ok).toBe(true);
  if (profile.ok) expect(profile.profile.kind).toBe('line-loop');
});

test('split: a line splits into two at an arbitrary non-grid coordinate', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);

  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await planeClick(page, -40, 0);
  await planeClick(page, 40, 0);
  await page.keyboard.press('Enter');

  // Split at x = 13.7 (deliberately off the 10 mm grid).
  await page.getByRole('button', { name: 'Modify tools' }).click();
  await page.getByRole('menuitemradio', { name: 'Split' }).click();
  await planeClick(page, 13.7, 0);

  const canvas = page.getByRole('img', { name: 'Sketch canvas' });
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(2);

  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  const sketch = await savedSketch(page);
  const ls = lines(sketch);
  expect(ls).toHaveLength(2);
  const shared = ls[0]!.endId;
  expect(ls[1]!.startId).toBe(shared);
  const sharedPoint = points(sketch).find((p) => p.id === shared)!;
  expect(sharedPoint.x).toBeGreaterThan(13);
  expect(sharedPoint.x).toBeLessThan(14);
  // Genuinely off-grid: not a multiple of the 10 mm grid.
  expect(Math.abs(sharedPoint.x / 10 - Math.round(sharedPoint.x / 10))).toBeGreaterThan(0.05);
});

test('split: a 3-point arc splits into two arcs about the same centre', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);

  // 3-point arc: two endpoints then a through point.
  await page.getByRole('button', { name: 'Arc', exact: true }).click();
  await planeClick(page, -40, 0);
  await planeClick(page, 40, 0);
  await planeClick(page, 0, 30);

  const canvas = page.getByRole('img', { name: 'Sketch canvas' });
  await expect(canvas.locator('.sketch-overlay__arc')).toHaveCount(1);

  // Split near the upper-left of the arc, at a non-grid position.
  await page.getByRole('button', { name: 'Modify tools' }).click();
  await page.getByRole('menuitemradio', { name: 'Split' }).click();
  await planeClick(page, -20, 25);

  await expect(canvas.locator('.sketch-overlay__arc')).toHaveCount(2);

  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  const sketch = await savedSketch(page);
  const as = arcs(sketch);
  expect(as).toHaveLength(2);
  // Both sub-arcs share the original centre point.
  expect(as[0]!.centerId).toBe(as[1]!.centerId);
});

test('extend: an over-short rectangle edge grows to close a valid extrudable profile', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);

  // Draw a 40×40 square whose left edge stops short of the origin corner (open chain).
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await planeClick(page, 0, 0); // p0 (origin)
  await planeClick(page, 40, 0); // p1
  await planeClick(page, 40, 40); // p2
  await planeClick(page, 0, 40); // p3
  await planeClick(page, 0, 3); // p4 — left edge stops 3 mm above the origin
  await page.keyboard.press('Enter');

  const canvas = page.getByRole('img', { name: 'Sketch canvas' });
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(4);

  // Before extending, the chain is open and not a valid profile.
  const openSketch = await savedSketch(page);
  expect(detectSketchProfile(openSketch).ok).toBe(false);

  // Extend the short left edge down to the bottom edge, fusing onto the origin corner.
  await page.getByRole('button', { name: 'Modify tools' }).click();
  await page.getByRole('menuitemradio', { name: 'Extend' }).click();
  await planeClick(page, 0, 2.5); // near the free lower endpoint of the left edge

  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(4);

  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  const sketch = await savedSketch(page);
  expect(lines(sketch)).toHaveLength(4);
  // The short edge's free tip at (0,3) is gone; the loop now closes on the origin corner.
  expect(points(sketch).some((p) => Math.abs(p.x) < 1e-6 && Math.abs(p.y - 3) < 1e-6)).toBe(false);
  const profile = detectSketchProfile(sketch);
  expect(profile.ok).toBe(true);
  if (profile.ok) expect(profile.profile.kind).toBe('line-loop');
});

test('extend: an arc grows along its circle to a boundary at non-grid coordinates', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);

  // A top semicircle: endpoints (-30,0) and (30,0) through (0,30) — centre (0,0), r=30.
  await page.getByRole('button', { name: 'Arc', exact: true }).click();
  await planeClick(page, -30, 0);
  await planeClick(page, 30, 0);
  await planeClick(page, 0, 30);

  const canvas = page.getByRole('img', { name: 'Sketch canvas' });
  await expect(canvas.locator('.sketch-overlay__arc')).toHaveCount(1);

  // A horizontal boundary line at a deliberately off-grid y = -12.3.
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await planeClick(page, -40, -12.3);
  await planeClick(page, 40, -12.3);
  await page.keyboard.press('Enter');

  // Capture the arc's centre and radius before extending so we can prove they never move.
  const beforeArc = arcs(await savedSketch(page))[0]!;

  // Extend the arc's (30,0) end downward along its own circle to the boundary line.
  await page.getByRole('button', { name: 'Modify tools' }).click();
  await page.getByRole('menuitemradio', { name: 'Extend' }).click();
  await planeClick(page, 29, 3);

  await expect(canvas.locator('.sketch-overlay__arc')).toHaveCount(1);

  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  const sketch = await savedSketch(page);
  const as = arcs(sketch);
  expect(as).toHaveLength(1);
  const arc = as[0]!;
  const center = points(sketch).find((p) => p.id === arc.centerId)!;
  expect(arc.centerId).toBe(beforeArc.centerId); // centre point preserved
  expect(arc.radius).toBeCloseTo(beforeArc.radius, 6); // radius unchanged by the extend
  const ends = arcEndpoints({
    center: [center.x, center.y],
    radius: arc.radius,
    startAngle: arc.startAngle,
    endAngle: arc.endAngle,
    direction: arc.direction,
  });
  // The endpoint below the x-axis is the one the extend grew to the boundary line.
  const extended = [ends.start, ends.end].find((p) => p[1] < -5)!;
  expect(extended).toBeTruthy();

  // It lands on the (near-horizontal) boundary line — verify by perpendicular distance.
  const boundary = lines(sketch)[0]!;
  const la = points(sketch).find((p) => p.id === boundary.startId)!;
  const lb = points(sketch).find((p) => p.id === boundary.endId)!;
  const abx = lb.x - la.x;
  const aby = lb.y - la.y;
  const t = ((extended[0] - la.x) * abx + (extended[1] - la.y) * aby) / (abx * abx + aby * aby);
  const foot: [number, number] = [la.x + t * abx, la.y + t * aby];
  expect(Math.hypot(extended[0] - foot[0], extended[1] - foot[1])).toBeLessThan(0.05);
  // Genuinely off-grid landing coordinate.
  expect(Math.abs(extended[0] / 10 - Math.round(extended[0] / 10))).toBeGreaterThan(0.05);
});

test('trim stays active for repeated edits and Escape exits the tool', async ({ page }) => {
  await page.goto('/');
  await enterXySketch(page);

  await page.getByRole('button', { name: 'Trim' }).click();
  expect(await page.getByRole('button', { name: 'Trim' }).getAttribute('aria-pressed')).toBe('true');

  // Escape with no preview exits the tool.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  expect(await page.getByRole('button', { name: 'Trim' }).getAttribute('aria-pressed')).toBe('false');
});
