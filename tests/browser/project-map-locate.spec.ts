import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { monoFixture, REPO_ROOT } from './map-fixture.ts';
import { addProject, openMap, sky } from './map-page.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

interface Traffic {
  locate: string[];
  areas: string[];
}

function watchTraffic(page: Page): Traffic {
  const traffic: Traffic = { locate: [], areas: [] };
  page.on('request', (request) => {
    const { pathname, searchParams } = new URL(request.url());
    if (pathname.endsWith('/map/locate'))
      traffic.locate.push(searchParams.getAll('path').join(','));
    const area = pathname.match(/\/map\/areas\/([^/]+)$/)?.[1];
    if (area) traffic.areas.push(area);
  });
  return traffic;
}

async function quiet(traffic: Traffic): Promise<void> {
  let last = -1;
  await expect
    .poll(
      async () => {
        const seen = traffic.areas.length;
        const settled = seen === last;
        last = seen;
        await new Promise((resolve) => setTimeout(resolve, 600));
        return settled;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function search(page: Page, query: string, option: RegExp): Promise<void> {
  await page.keyboard.press('/');
  const box = page.getByRole('combobox', { name: 'Find a file on the map' });
  await expect(box).toBeFocused();
  await box.fill(query);
  await page.getByRole('option', { name: option }).first().click();
}

test('finding a file in an area that is not loaded asks where it is and loads that one area', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const traffic = watchTraffic(page);
  const projectId = await addProject(page, REPO_ROOT);
  const fixture = monoFixture(projectId);
  await openMap(page, fixture, 'graphite', undefined, { view: 'tree' });
  await quiet(traffic);

  const requested = new Set(traffic.areas);
  const everyPath = [...fixture.projects.get(projectId)!.files.values()].flat();
  const unique = (file: string) =>
    everyPath.filter((other) => path.basename(other.path) === path.basename(file)).length === 1;
  const candidates = [...fixture.projects.get(projectId)!.files]
    .filter(([areaId]) => !requested.has(areaId))
    .flatMap(([areaId, files]) =>
      files
        .filter((file) => existsSync(path.join(REPO_ROOT, file.path)) && unique(file.path))
        .filter((file) => file.path.endsWith('.ts') && !file.path.includes('.test.'))
        .slice(0, 1)
        .map((file) => ({ areaId, path: file.path })),
    );
  expect(
    candidates.length,
    'Every area was already loaded, so nothing is left to locate.',
  ).toBeGreaterThan(0);
  const target = candidates[0]!;
  const before = { locate: traffic.locate.length, areas: traffic.areas.length };

  const name = path.basename(target.path);
  await search(page, name, new RegExp(name.replace(/\./g, '\\.')));

  await expect.poll(() => traffic.areas.includes(target.areaId), { timeout: 15_000 }).toBe(true);
  await quiet(traffic);
  expect(traffic.locate.slice(before.locate)).toEqual([target.path]);
  expect(traffic.areas.slice(before.areas)).toEqual([target.areaId]);
});

test('a file that is not on the map is reported without loading any area', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const traffic = watchTraffic(page);
  const projectId = await addProject(page, REPO_ROOT);
  const fixture = monoFixture(projectId);
  await openMap(page, fixture);
  await expect(sky(page)).toBeVisible();
  await quiet(traffic);
  const known = new Set(
    [...fixture.projects.get(projectId)!.files.values()].flatMap((files) =>
      files.map((file) => file.path),
    ),
  );
  const missing = 'pnpm-workspace.yaml';
  expect(known.has(missing)).toBe(false);
  expect(existsSync(path.join(REPO_ROOT, missing))).toBe(true);
  const before = { locate: traffic.locate.length, areas: traffic.areas.length };

  await search(page, missing, new RegExp(missing.replace('.', '\\.')));

  await expect(page.getByText(`${missing} is not on the map.`)).toBeVisible({ timeout: 15_000 });
  await quiet(traffic);
  expect(traffic.locate.slice(before.locate)).toEqual([missing]);
  expect(traffic.areas.slice(before.areas)).toEqual([]);
});
