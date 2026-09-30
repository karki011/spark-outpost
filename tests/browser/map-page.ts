import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { serveMap, type MapFixture } from './map-fixture.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';

export const sky = (page: Page) => page.getByRole('application', { name: /map of/ });

export async function addProject(page: Page, rootPath: string): Promise<string> {
  const response = await page.request.post('/api/projects', { data: { rootPath } });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

export async function openMap(
  page: Page,
  fixture: MapFixture,
  theme = 'graphite',
  projects?: string[],
) {
  await serveMap(page, fixture);
  await page.addInitScript(
    ({ skin, ids }) => {
      localStorage.setItem('spark-outpost.view', 'map');
      localStorage.setItem('spark-outpost.theme', skin);
      if (ids) localStorage.setItem('spark-outpost.map-projects', JSON.stringify(ids));
    },
    { skin: theme, ids: projects ?? null },
  );
  await page.goto('/');
  await expect(sky(page).or(page.getByRole('list', { name: 'Areas' }))).toBeVisible();
}

export async function screenshot(page: Page, name: string) {
  if (SHOTS === '') return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}
