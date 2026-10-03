import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { APP_ORIGIN, PACKAGED } from './stub-config.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

interface PageAnswer {
  status: number;
  error: string | null;
}

function pageRequest(page: Page, method: string, url: string): Promise<PageAnswer> {
  return page.evaluate(
    async ({ method, url }) => {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        keepalive: method === 'DELETE',
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      return { status: response.status, error: payload?.error ?? null };
    },
    { method, url },
  );
}

test('the app is served by the API only to callers with the launch token @packaged', async ({
  page,
}) => {
  test.skip(!PACKAGED, 'Only the packaged layout serves the app from the API.');
  for (const path of ['/', '/island', '/api/health']) {
    expect((await fetch(`${APP_ORIGIN}${path}`)).status).toBe(401);
  }

  const failed: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
  expect(failed).toEqual([]);
});

test('bodyless DELETE and PATCH requests from the page reach their routes @packaged', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
  const id = randomUUID();
  const created = await page.request.post('/api/conversations', { data: { id } });
  expect(created.status()).toBe(201);

  expect(await pageRequest(page, 'PATCH', `/api/conversations/${id}`)).toMatchObject({
    status: 400,
  });
  expect(await pageRequest(page, 'DELETE', '/api/tickets/linear/ENG-1/snooze')).toMatchObject({
    status: 404,
  });
  expect(await pageRequest(page, 'DELETE', `/api/conversations/${id}`)).toEqual({
    status: 204,
    error: null,
  });
  expect((await page.request.get(`/api/conversations/${id}`)).status()).toBe(404);
});
