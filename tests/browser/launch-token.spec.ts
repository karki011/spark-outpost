import { expect, test } from '@playwright/test';
import { API_TOKEN_HEADER } from '../../packages/contracts/src/api-token.ts';
import { resetTestDatabase } from './database.ts';

const DIRECT_API = 'http://127.0.0.1:4319/api';

test('the API refuses callers without the launch token', async ({ request }) => {
  const health = await request.get(`${DIRECT_API}/health`);
  expect(health.status()).toBe(401);
  const events = await request.get(`${DIRECT_API}/events`);
  expect(events.status()).toBe(401);
  const forged = await request.get(`${DIRECT_API}/conversations`, {
    headers: { [API_TOKEN_HEADER]: 'guessed-token' },
  });
  expect(forged.status()).toBe(401);
});

test('the web app reaches the API without ever holding the token', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const tokenHeaders: string[] = [];
  page.on('request', (request) => {
    const header = request.headers()[API_TOKEN_HEADER];
    if (header !== undefined) tokenHeaders.push(request.url());
  });
  const events = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/events',
  );
  await page.goto('/');
  expect((await events).status()).toBe(200);
  await expect(page.getByRole('main')).toBeVisible();
  expect(tokenHeaders).toEqual([]);
});
