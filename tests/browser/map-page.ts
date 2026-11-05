import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { serveMap, type MapFixture } from './map-fixture.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';

export const sky = (page: Page) => page.getByRole('application', { name: /map of/ });
export const tree = (page: Page) => page.getByRole('application', { name: /^Tree of/ });
export const outline = (page: Page) => page.getByRole('tree', { name: /^Outline of/ });

export type MapViewName = 'tree' | 'focus' | 'outline' | 'sky';
const ALL_VIEWS: MapViewName[] = ['tree', 'focus', 'outline', 'sky'];

interface OpenOptions {
  view?: MapViewName | null;
  tips?: boolean;
}

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
  { view = 'sky', tips = false }: OpenOptions = {},
) {
  await serveMap(page, fixture);
  await page.addInitScript(
    ({ skin, ids, chosen, dismissed }) => {
      localStorage.setItem('spark-outpost.view', 'map');
      localStorage.setItem('spark-outpost.theme', skin);
      if (ids) localStorage.setItem('spark-outpost.map-projects', JSON.stringify(ids));
      if (chosen) localStorage.setItem('spark-outpost.map-view', JSON.stringify(chosen));
      localStorage.setItem('spark-outpost.map-tips', JSON.stringify(dismissed));
    },
    { skin: theme, ids: projects ?? null, chosen: view, dismissed: tips ? [] : ALL_VIEWS },
  );
  await page.goto('/');
  await expect(page.locator('.map-stage')).toBeVisible();
}

export async function screenshot(page: Page, name: string) {
  if (SHOTS === '') return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}
