import type { CadDocumentV2, ExtrudeFeature, SketchFeature } from '@swalha-cad/document';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

// Milestone 2 release-gate proof: the complete human sketch-to-solid workflow driven
// end-to-end through the real browser UI — XY sketch on arbitrary (off-grid) coordinates,
// orientation constraints, the D distance tool to a fully constrained state, extrude,
// depth edit, undo/redo, save/reload, delete/restore, and a parseable exported STL.
test.use({ viewport: { width: 1440, height: 900 } });

const HEADER_SIZE = 80;
const TRIANGLE_SIZE = 50;

interface ParsedStl {
  readonly triangleCount: number;
  readonly bounds: { readonly min: [number, number, number]; readonly max: [number, number, number] };
  readonly coordinates: readonly number[];
}

/** Independent binary STL reader (spec-driven, not reused from the exporter under test). */
function parseBinaryStl(bytes: Buffer): ParsedStl {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangleCount = view.getUint32(HEADER_SIZE, true);
  expect(bytes.byteLength).toBe(HEADER_SIZE + 4 + triangleCount * TRIANGLE_SIZE);

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const coordinates: number[] = [];
  let offset = HEADER_SIZE + 4;
  for (let i = 0; i < triangleCount; i++) {
    offset += 12; // facet normal
    for (let v = 0; v < 3; v++) {
      const x = view.getFloat32(offset, true);
      const y = view.getFloat32(offset + 4, true);
      const z = view.getFloat32(offset + 8, true);
      offset += 12;
      coordinates.push(x, y, z);
      min[0] = Math.min(min[0], x);
      min[1] = Math.min(min[1], y);
      min[2] = Math.min(min[2], z);
      max[0] = Math.max(max[0], x);
      max[1] = Math.max(max[1], y);
      max[2] = Math.max(max[2], z);
    }
    offset += 2; // attribute byte count
  }
  return { triangleCount, bounds: { min, max }, coordinates };
}

async function clickCanvas(page: Page, canvas: Locator, fx: number, fy: number): Promise<void> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('sketch canvas has no bounding box');
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

/** Clicks the centre of a rendered locator's bounding box (used to hit thin lines). */
async function clickCentre(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('target has no bounding box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function enterXySketch(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Sketch' }).click();
  await page.getByRole('menuitem', { name: 'Top Plane (XY)' }).click();
  await expect(page.getByRole('toolbar', { name: 'Sketch tools' })).toBeVisible();
  return page.getByRole('img', { name: 'Sketch canvas' });
}

async function exportStl(page: Page): Promise<ParsedStl> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export STL', exact: true }).click();
  const path = await (await download).path();
  expect(path).toBeTruthy();
  return parseBinaryStl(await readFile(path!));
}

// Rectangle edges are rendered in construction order: top, right, bottom, left.
const EDGES = { top: 0, right: 1, bottom: 2, left: 3 } as const;

async function selectEdge(page: Page, canvas: Locator, edge: keyof typeof EDGES): Promise<void> {
  await clickCentre(page, canvas.locator('.sketch-overlay__line').nth(EDGES[edge]));
}

async function applyConstraint(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `${name} constraint`, exact: true }).click();
}

/** Uses the command-first D tool to drive a selected edge's length to an exact value. */
async function dimensionEdge(page: Page, canvas: Locator, edge: keyof typeof EDGES, value: number): Promise<void> {
  await page.keyboard.press('d');
  await selectEdge(page, canvas, edge);
  const editor = page.getByLabel('Dimension value');
  await expect(editor).toBeVisible();
  await editor.fill(String(value));
  await editor.press('Enter');
  await expect(page.getByLabel('Dimension value')).toHaveCount(0);
}

test('proves the full human sketch → constrain → extrude → persist → delete workflow', async ({ page }) => {
  await page.goto('/');

  // 1. Enter an XY sketch and draw a rectangle at arbitrary, non-grid canvas coordinates.
  const canvas = await enterXySketch(page);
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await clickCanvas(page, canvas, 0.337, 0.386);
  await clickCanvas(page, canvas, 0.628, 0.641);
  await expect(canvas.locator('.sketch-overlay__line')).toHaveCount(4);
  // Toggle the rectangle tool off so the canvas enters selection mode.
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();

  const geometry = canvas.locator('.sketch-overlay__geometry');
  await expect(geometry).toHaveClass(/sketch-overlay__geometry--under-constrained/);
  await expect(page.locator('.status-bar__solve--under-constrained')).toBeVisible();

  // 2. Orient the rectangle with horizontal / vertical constraints.
  await selectEdge(page, canvas, 'top');
  await applyConstraint(page, 'Horizontal');
  await selectEdge(page, canvas, 'right');
  await applyConstraint(page, 'Vertical');
  await selectEdge(page, canvas, 'bottom');
  await applyConstraint(page, 'Horizontal');
  await selectEdge(page, canvas, 'left');
  await applyConstraint(page, 'Vertical');

  // 3. Remove the last degrees of freedom with the D distance tool.
  await dimensionEdge(page, canvas, 'top', 60);
  await dimensionEdge(page, canvas, 'right', 35);

  // 4. Reach and observe a valid, fully constrained solver state.
  await expect(geometry).toHaveClass(/sketch-overlay__geometry--fully-constrained/);
  await expect(page.locator('.constraint-status--fully-constrained')).toBeVisible();
  await expect(page.locator('.status-bar__solve--fully-constrained')).toBeVisible();

  // 5. Finish the sketch and return to the Part Studio.
  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await expect(page.getByRole('toolbar', { name: 'Sketch tools' })).toHaveCount(0);

  const sceneTree = page.getByRole('navigation', { name: 'Scene tree' });
  const beforeExtrude = await exportStl(page);

  // 6. Extrude the constrained profile into a watertight solid.
  await page.getByRole('button', { name: 'Extrude' }).click();
  const dialog = page.getByRole('form', { name: 'Extrude' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Depth').fill('40');
  await dialog.getByRole('button', { name: 'Confirm extrude' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(sceneTree.getByRole('button', { name: 'Extrude 1' })).toBeVisible();

  const afterExtrude = await exportStl(page);
  expect(afterExtrude.triangleCount).toBeGreaterThan(beforeExtrude.triangleCount);
  // The extrusion is the tallest body in the scene, so it dominates the +Z world bound.
  expect(afterExtrude.bounds.max[2]).toBeCloseTo(40, 1);

  // 7. Edit the extrusion depth in place and confirm the solid rebuilds deterministically.
  await sceneTree.getByRole('button', { name: 'Extrude 1' }).dblclick();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Depth')).toHaveValue('40');
  await dialog.getByLabel('Depth').fill('22');
  await dialog.getByRole('button', { name: 'Confirm extrude' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(sceneTree.getByRole('button', { name: 'Extrude 1' })).toHaveCount(1);
  expect((await exportStl(page)).bounds.max[2]).toBeCloseTo(22, 1);

  // 8. Undo the depth edit (back to 40mm), then redo it (back to 22mm).
  await page.keyboard.press('Control+z');
  expect((await exportStl(page)).bounds.max[2]).toBeCloseTo(40, 1);
  await page.keyboard.press('Control+Shift+z');
  expect((await exportStl(page)).bounds.max[2]).toBeCloseTo(22, 1);

  // 9. Save the versioned document, verify the persisted V2 schema, and reload it.
  const saveDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const savedPath = await (await saveDownload).path();
  const saved = JSON.parse(await readFile(savedPath!, 'utf-8')) as CadDocumentV2;
  expect(saved.schemaVersion).toBe(2);
  const savedSketch = saved.features.find((f): f is SketchFeature => f.kind === 'sketch');
  const savedExtrude = saved.features.find((f): f is ExtrudeFeature => f.kind === 'extrude');
  expect(savedSketch?.constraints.some((c) => c.kind === 'distance' && c.value === 60)).toBe(true);
  expect(savedExtrude).toMatchObject({ kind: 'extrude', depth: 22 });

  await page.reload();
  await expect(sceneTree.getByRole('button', { name: 'Extrude 1' })).toHaveCount(0);
  await page.locator('input[type="file"]').setInputFiles(savedPath!);
  await expect(sceneTree.getByRole('button', { name: 'Extrude 1' })).toBeVisible();
  expect((await exportStl(page)).bounds.max[2]).toBeCloseTo(22, 1);

  // 10. Delete the reloaded extrusion, then restore it with undo — proving the feature
  //     survives a full round trip and the deletion is reversible.
  await sceneTree.getByRole('button', { name: 'Extrude 1' }).click();
  await page.keyboard.press('Delete');
  await expect(sceneTree.getByRole('button', { name: 'Extrude 1' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(sceneTree.getByRole('button', { name: 'Extrude 1' })).toBeVisible();

  // 11. Final export is still a valid, finite, watertight-bounded STL of the rebuilt solid.
  const finalStl = await exportStl(page);
  expect(finalStl.triangleCount).toBeGreaterThan(0);
  for (const coordinate of finalStl.coordinates) expect(Number.isFinite(coordinate)).toBe(true);
  expect(finalStl.bounds.max[2]).toBeCloseTo(22, 1);
});
