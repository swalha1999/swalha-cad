import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

function sceneTree(page: Page) {
  return page.getByRole('navigation', { name: 'Scene tree' });
}

test.describe('Onshape-style deletion', () => {
  test('deletes a visible body with the Delete key and restores it with undo', async ({ page }) => {
    await page.goto('/');
    const tree = sceneTree(page);
    await expect(tree.getByRole('button', { name: 'Box' })).toBeVisible();

    // Select the body in the feature tree, then delete it with the keyboard.
    await tree.getByRole('button', { name: 'Box' }).click();
    await page.keyboard.press('Delete');

    await expect(tree.getByRole('button', { name: 'Box' })).toHaveCount(0);

    // Undo brings the deleted body back.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(tree.getByRole('button', { name: 'Box' })).toBeVisible();
  });

  test('deletes a body through the right-click context menu', async ({ page }) => {
    await page.goto('/');
    const tree = sceneTree(page);

    await tree.getByRole('button', { name: 'Cylinder' }).click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Delete Cylinder' }).click();

    await expect(tree.getByRole('button', { name: 'Cylinder' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(tree.getByRole('button', { name: 'Cylinder' })).toBeVisible();
  });

  test('typing Backspace inside a numeric dimension field never deletes geometry', async ({ page }) => {
    await page.goto('/');
    const tree = sceneTree(page);

    // Select the box so its editable dimensions appear in the properties panel.
    await tree.getByRole('button', { name: 'Box' }).click();
    const widthField = page.getByLabel('Width');
    await expect(widthField).toBeVisible();

    // Edit the field with Backspace — this must edit text, not delete the body.
    await widthField.click();
    await widthField.press('End');
    await widthField.press('Backspace');
    await widthField.press('Backspace');

    // The body is still present; Backspace stayed inside the field.
    await expect(tree.getByRole('button', { name: 'Box' })).toBeVisible();
  });
});
