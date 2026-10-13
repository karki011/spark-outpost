import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { FONT_HOSTS } from './terminal-font-probe.ts';

test('the app shows before its bundled fonts have loaded, and asks no font host', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  let askedHost = 0;
  let askedBundled = 0;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(FONT_HOSTS, (route) => {
    askedHost += 1;
    return route.abort();
  });
  await page.route('**/fonts/*.woff2', async (route) => {
    askedBundled += 1;
    await held;
    await route.continue();
  });
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  expect(askedBundled).toBeGreaterThan(0);
  expect(askedHost).toBe(0);
  release();
});
