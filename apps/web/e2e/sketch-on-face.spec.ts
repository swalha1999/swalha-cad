import type { CadDocumentV2, SketchFeature } from '@swalha-cad/document';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { openSketchOnPlane } from './helpers.js';

// Release-gate proof for FACE-BASED SKETCHING driven end-to-end through the real
// browser: extrude a box, select one of its planar faces (both preselect and
// command-then-face orders), sketch on the face at off-grid coordinates, and
// extrude the new profile into a solid located on that face — then save/reload.
test.use({ viewport: { width: 1440, height: 900 } });

const HEADER_SIZE = 80;

/** Independent binary STL reader — returns only the world Z bounds we assert on. */
function stlZBounds(bytes: Buffer): { min: number; max: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangleCount = view.getUint32(HEADER_SIZE, true);
  let min = Infinity;
  let max = -Infinity;
  let offset = HEADER_SIZE + 4;
  for (let i = 0; i < triangleCount; i++) {
    offset += 12; // facet normal
    for (let v = 0; v < 3; v++) {
      const z = view.getFloat32(offset + 8, true);
      offset += 12;
      min = Math.min(min, z);
      max = Math.max(max, z);
    }
    offset += 2; // attribute byte count
  }
  return { min, max };
}

/** Clicks a fraction of a locator's bounding box (used for both the 3D viewport and the sketch SVG). */
async function clickFraction(page: Page, target: Locator, fx: number, fy: number): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('target has no bounding box');
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

async function exportStlZBounds(page: Page): Promise<{ min: number; max: number }> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export STL', exact: true }).click();
  const path = await (await download).path();
  expect(path).toBeTruthy();
  return stlZBounds(await readFile(path!));
}

const viewportCanvas = (page: Page) => page.locator('canvas.viewport__canvas');
const sketchCanvas = (page: Page) => page.getByRole('img', { name: 'Sketch canvas' });

/** Builds a box centred on the world origin: a symmetric-extruded rectangle drawn about the canvas centre. */
async function buildSymmetricBox(page: Page): Promise<void> {
  await openSketchOnPlane(page, 'Top');
  const canvas = sketchCanvas(page);
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  // Symmetric about the canvas centre → the profile (and the solid) centre on the world XY origin.
  await clickFraction(page, canvas, 0.36, 0.4);
  await clickFraction(page, canvas, 0.64, 0.6);
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(4);
  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await expect(page.getByRole('toolbar', { name: 'Sketch tools' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  const dialog = page.getByRole('form', { name: 'Extrude' });
  await dialog.getByRole('button', { name: 'Symmetric' }).click();
  await dialog.getByLabel('Depth').fill('40');
  await dialog.getByRole('button', { name: 'Confirm extrude' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Scene tree' }).getByRole('button', { name: 'Extrude 1' })).toBeVisible();
}

/** Orients the camera with an orthographic standard view so the named face fills the canvas centre for a deterministic pick. */
async function orthoView(page: Page, view: 'Top view' | 'Front view' | 'Right view'): Promise<void> {
  await page.getByRole('button', { name: 'Orthographic' }).click();
  await page.getByRole('button', { name: view }).click();
}

/** Draws an off-grid rectangle in the active sketch and returns to the Part Studio. */
async function drawRectangleAndFinish(page: Page): Promise<void> {
  const canvas = sketchCanvas(page);
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await clickFraction(page, canvas, 0.43, 0.44);
  await clickFraction(page, canvas, 0.61, 0.59);
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(4);
  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await expect(page.getByRole('toolbar', { name: 'Sketch tools' })).toHaveCount(0);
}

test('preselect a top face, sketch on it, and extrude a stacked solid', async ({ page }) => {
  await page.goto('/');
  await buildSymmetricBox(page);

  // Z-up: the symmetric box's +Z top cap (at z=20) faces the top orthographic
  // camera looking straight down world Z, so a centre click preselects it.
  await orthoView(page, 'Top view');

  // Preselect-then-Sketch: click the face in the viewport to preselect it, then the
  // single Sketch action enters immediately (no support command needed).
  await clickFraction(page, viewportCanvas(page), 0.5, 0.5);
  await page.getByRole('button', { name: 'Sketch', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Sketch tools' })).toBeVisible();

  await drawRectangleAndFinish(page);

  // Extrude the new face sketch (Sketch 2) into a solid sitting on top of the box.
  const sceneTree = page.getByRole('navigation', { name: 'Scene tree' });
  await sceneTree.getByRole('button', { name: 'Sketch 2' }).click();
  await page.getByRole('button', { name: 'Extrude', exact: true }).click();
  const dialog = page.getByRole('form', { name: 'Extrude' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Depth').fill('10');
  await dialog.getByRole('button', { name: 'Confirm extrude' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(sceneTree.getByRole('button', { name: 'Extrude 2' })).toBeVisible();

  // The base box tops out at z=20; the face-supported solid sweeps +10 above it to z=30.
  const bounds = await exportStlZBounds(page);
  expect(bounds.min).toBeCloseTo(-20, 0);
  expect(bounds.max).toBeCloseTo(30, 0);
});

test('command-then-face on a side face, then save and reload', async ({ page }) => {
  await page.goto('/');
  await buildSymmetricBox(page);

  // A side wall (+X) faces the right orthographic camera, centred on the origin.
  await orthoView(page, 'Right view');

  // Command-then-face: press Sketch with no preselection to open the support command,
  // click the face to populate the collector, then confirm to enter the sketch.
  await page.getByRole('button', { name: 'Sketch', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Select a sketch plane or planar face' })).toBeVisible();
  await clickFraction(page, viewportCanvas(page), 0.5, 0.5);
  await page.getByRole('button', { name: 'Create sketch' }).click();
  await expect(page.getByRole('toolbar', { name: 'Sketch tools' })).toBeVisible();

  await drawRectangleAndFinish(page);

  // Save the document and prove the face-supported sketch persisted its stable reference.
  const saveDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const savedPath = await (await saveDownload).path();
  const saved = JSON.parse(await readFile(savedPath!, 'utf-8')) as CadDocumentV2;
  const faceSketch = saved.features.find((f): f is SketchFeature => f.kind === 'sketch' && f.face !== undefined);
  expect(faceSketch).toBeTruthy();
  expect(faceSketch!.face).toMatchObject({ bodyId: expect.any(String), faceId: expect.stringContaining('side:') });

  // Reload from the saved file and confirm both sketches survive the round trip.
  await page.reload();
  const sceneTree = page.getByRole('navigation', { name: 'Scene tree' });
  await expect(sceneTree.getByRole('button', { name: 'Extrude 1' })).toHaveCount(0);
  await page.locator('input[type="file"]').setInputFiles(savedPath!);
  await expect(sceneTree.getByRole('button', { name: 'Extrude 1' })).toBeVisible();
  await expect(sceneTree.getByRole('button', { name: 'Sketch 2' })).toBeVisible();
});
