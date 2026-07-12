import { expect, test } from '@playwright/test';

/**
 * Every NumericField commits on blur, even when its value is unchanged, so
 * moving focus between fields can push extra no-op history entries. Polling
 * for the expected value (rather than asserting an exact undo/redo click
 * count) keeps this test robust to those harmless intermediate commits.
 */
async function clickUntil(click: () => Promise<void>, isDone: () => Promise<boolean>, maxClicks = 10): Promise<void> {
  for (let attempt = 0; attempt < maxClicks; attempt++) {
    if (await isDone()) return;
    await click();
  }
  throw new Error(`condition not met after ${maxClicks} clicks`);
}

test('creates an L-bracket, edits its dimensions and transform, and undo/redo restores state', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('group', { name: 'Add primitive' }).getByRole('button', { name: 'Add L-Bracket' }).click();

  const sceneTree = page.getByRole('navigation', { name: 'Scene tree' });
  const sceneRow = sceneTree.getByRole('button', { name: 'L-Bracket' });
  await expect(sceneRow).toHaveAttribute('aria-current', 'true');

  const properties = page.getByRole('complementary', { name: 'Properties' });
  await expect(properties.getByLabel('Width')).toHaveValue('50');
  await expect(properties.getByLabel('Translate X')).toHaveValue('0');

  await properties.getByLabel('Width').fill('80');
  await properties.getByLabel('Width').press('Tab');
  await expect(properties.getByLabel('Width')).toHaveValue('80');

  await properties.getByLabel('Translate X').fill('15');
  await properties.getByLabel('Translate X').press('Tab');
  await expect(properties.getByLabel('Translate X')).toHaveValue('15');

  const undoButton = page.getByRole('button', { name: 'Undo', exact: true });
  const redoButton = page.getByRole('button', { name: 'Redo', exact: true });
  await expect(undoButton).toBeEnabled();
  await expect(redoButton).toBeDisabled();

  // Undo unwinds the transform edit first, then the dimension edit, then removes the entity itself.
  await clickUntil(
    () => undoButton.click(),
    async () => (await properties.getByLabel('Translate X').inputValue()) === '0',
  );
  await clickUntil(
    () => undoButton.click(),
    async () => (await properties.getByLabel('Width').inputValue()) === '50',
  );
  await clickUntil(
    () => undoButton.click(),
    async () => (await sceneTree.getByRole('button', { name: 'L-Bracket' }).count()) === 0,
  );
  await expect(properties.getByText('No selection')).toBeVisible();
  await expect(undoButton).toBeDisabled();

  // Redo replays every command and reconstructs the fully edited entity.
  await clickUntil(
    () => redoButton.click(),
    async () => (await sceneTree.getByRole('button', { name: 'L-Bracket' }).count()) === 1,
  );
  await expect(redoButton).toBeEnabled();
  await clickUntil(() => redoButton.click(), async () => !(await redoButton.isEnabled()));

  await sceneTree.getByRole('button', { name: 'L-Bracket' }).click();
  await expect(properties.getByLabel('Width')).toHaveValue('80');
  await expect(properties.getByLabel('Translate X')).toHaveValue('15');
});
