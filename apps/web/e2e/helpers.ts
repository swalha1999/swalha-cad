import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** The origin-plane rows in the feature tree, by their short label. */
export type PlaneLabel = 'Top' | 'Front' | 'Right';

/**
 * Opens a sketch on an origin plane the deterministic way: preselect the plane's
 * row in the feature tree, then press the single Sketch action, which enters the
 * sketch immediately (the preselect-then-Sketch path). Waits until the sketch
 * tools toolbar is present so callers can start drawing.
 */
export async function openSketchOnPlane(page: Page, plane: PlaneLabel = 'Top'): Promise<void> {
  const tree = page.getByRole('navigation', { name: 'Scene tree' });
  await tree.getByRole('button', { name: plane, exact: true }).click();
  await page.getByRole('button', { name: 'Sketch', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Sketch tools' })).toBeVisible();
}

/** Adds a primitive body of the given kind from the feature toolbar. */
export async function addPrimitive(page: Page, label: 'Add Box' | 'Add Cylinder' | 'Add L-Bracket'): Promise<void> {
  await page.getByRole('button', { name: label }).click();
}
