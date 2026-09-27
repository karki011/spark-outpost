import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('shows the reconnecting screen while the server restarts, then loads the app on its own', async ({
  page,
}) => {
  let setupCalls = 0;
  await page.route('**/api/setup', async (route) => {
    setupCalls += 1;
    if (setupCalls <= 2) {
      await route.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad Gateway' });
      return;
    }
    await route.continue();
  });

  await page.goto('/');

  const offline = page.getByRole('main', { name: 'Taking a quick nap' });
  await expect(offline).toBeVisible();
  await expect(offline).toContainText(
    "The Spark Outpost server isn't answering. It may be restarting.",
  );
  await expect(offline).toContainText(/Reconnecting/);
  await expect(offline.getByRole('button', { name: 'Try now' })).toBeVisible();
  await expect(offline.getByRole('status')).toHaveText('Tried 1 time. Still waiting.');

  await expect(page.getByRole('heading', { level: 1, name: /, Test$/ })).toBeVisible();
  await expect(offline).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Back online' })).toBeVisible();
  expect(setupCalls).toBe(3);
});

test('the crew keeps Scout company while offline and cheers when the server is back', async ({
  page,
}) => {
  let online = false;
  await page.route('**/api/setup', async (route) => {
    if (!online) {
      await route.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad Gateway' });
      return;
    }
    await route.continue();
  });
  await page.goto('/');
  const offline = page.getByRole('main', { name: 'Taking a quick nap' });
  await expect(offline).toBeVisible();
  const crew = page.locator('.offline-crew [data-crew]');
  await expect(crew).toHaveCount(4);
  expect(await crew.evaluateAll((walkers) => walkers.map((walker) => walker.dataset.crew))).toEqual(
    ['Bolt', 'Sketch', 'Hawk', 'Jev'],
  );
  const moving = await page
    .locator('.offline-crew .ow-roam')
    .first()
    .evaluate((element) => element.getAnimations().length);
  expect(moving).toBeGreaterThan(0);

  online = true;
  await offline.getByRole('button', { name: 'Try now' }).click();
  await expect(page.getByRole('heading', { name: 'Back online!' })).toBeVisible();
  await expect(page.locator('.offline-crew')).toHaveClass(/\bback\b/);
  await expect(page.getByRole('heading', { level: 1, name: /, Test$/ })).toBeVisible();
});

test('with reduced motion the crew stands still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/setup', (route) =>
    route.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad Gateway' }),
  );
  await page.goto('/');
  await expect(page.getByRole('main', { name: 'Taking a quick nap' })).toBeVisible();
  const crew = page.locator('.offline-crew');
  await expect(crew).toHaveClass(/\bstill\b/);
  await expect(crew.locator('[data-crew] svg')).toHaveCount(4);
  for (const svg of await crew.locator('[data-crew] svg').all()) await expect(svg).toBeVisible();
  const spots = () =>
    crew.locator('[data-crew] svg').evaluateAll((blobs) =>
      blobs.map((blob) => {
        const box = blob.getBoundingClientRect();
        const stage = blob.closest('.offline-stage')!.getBoundingClientRect();
        return [Math.round(box.x - stage.x), Math.round(box.y - stage.y)];
      }),
    );
  const before = await spots();
  await page.waitForTimeout(1500);
  expect(await spots()).toEqual(before);
});
