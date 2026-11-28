import { readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

const GUIDE = path.resolve(import.meta.dirname, '../../docs/guide');
const SLUGS = readdirSync(GUIDE)
  .filter((name) => name.endsWith('.md') && name !== 'README.md')
  .map((name) => name.slice(0, -3));

const docs = (page: Page) => page.getByRole('main', { name: 'Docs' });
const article = (page: Page) => docs(page).getByRole('article');
const contents = (page: Page) => docs(page).getByRole('button', { name: 'Contents', exact: true });
const sheet = (page: Page) => page.getByRole('complementary', { name: 'Guide contents' });

async function open(page: Page, slug: string) {
  await page.evaluate((target) => (window.location.hash = `#/docs/${target}`), slug);
  await expect(article(page)).toHaveAttribute('data-page', slug);
}

test('on a phone the contents are a sheet opened from a bar that stays put', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/docs/cards');
  await expect(article(page)).toHaveAttribute('data-page', 'cards');
  await expect(sheet(page)).toBeHidden();
  await page.locator('.docs-main').evaluate((element) => element.scrollTo(0, 1200));
  await expect(contents(page)).toBeInViewport();
  expect(Math.round((await contents(page).boundingBox())!.height)).toBeGreaterThanOrEqual(44);

  await contents(page).click();
  await expect(sheet(page)).toBeVisible();
  await expect(contents(page)).toBeHidden();
  await expect(article(page)).toBeHidden();
  await expect(sheet(page).getByRole('button', { name: 'Close contents' })).toBeFocused();
  const heights = await sheet(page)
    .locator('nav a:visible, nav h2 button')
    .evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
  expect(new Set(heights)).toEqual(new Set([44]));

  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();
  await expect(contents(page)).toBeFocused();

  await docs(page).getByRole('button', { name: 'Search', exact: true }).click();
  const search = sheet(page).getByRole('searchbox', { name: 'Search the guide' });
  await expect(search).toBeFocused();
  await search.fill('glossary');
  await sheet(page).getByRole('list', { name: 'Search results' }).getByRole('link').first().click();
  await expect(sheet(page)).toBeHidden();
  await expect(docs(page).getByRole('heading', { level: 1 })).toHaveText('Glossary');
});

test('on a phone a wide table stacks into labelled rows and a two-column one stays a table', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/docs/cards');
  const table = article(page).getByRole('table').first();
  const first = article(page).locator('.docs-body tbody tr').first();
  await expect(article(page).locator('.docs-body thead').first()).toBeHidden();
  await expect(first.locator('td').nth(1)).toHaveAttribute('data-label', 'Means');
  await expect(first.locator('td').nth(2)).toHaveAttribute('data-label', 'Buttons');
  const cells = await first
    .locator('td')
    .evaluateAll((list) => list.map((cell) => Math.round(cell.getBoundingClientRect().width)));
  expect(Math.min(...cells)).toBeGreaterThan(250);
  await expect(table).toBeAttached();

  await open(page, 'glossary');
  await expect(article(page).locator('.docs-body thead').first()).toBeVisible();
  await expect(article(page).locator('.docs-body td[data-label]')).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, 'cards');
  await expect(article(page).locator('.docs-body thead').first()).toBeVisible();
});

test('no guide page scrolls sideways on a phone', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/#/docs/welcome');
  expect(SLUGS.length).toBeGreaterThan(80);
  const wide: string[] = [];
  for (const slug of SLUGS) {
    await open(page, slug);
    const overflow = await page.evaluate(() => {
      const main = document.querySelector('.docs-main')!;
      const edge = main.getBoundingClientRect().right;
      const past = [...main.querySelectorAll('.docs-body table, .docs-article h1')].some(
        (element) => element.getBoundingClientRect().right > edge + 1,
      );
      return (
        past ||
        main.scrollWidth > main.clientWidth ||
        document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
    });
    if (overflow) wide.push(slug);
  }
  expect(wide).toEqual([]);
});

test('a narrow window gets the same bar, and the outline is one closed row', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto('/#/docs/answer-approvals');
  await expect(article(page)).toHaveAttribute('data-page', 'answer-approvals');
  await expect(sheet(page)).toBeHidden();
  await expect(contents(page)).toBeVisible();
  const outline = docs(page).getByRole('navigation', { name: 'On this page' });
  const toggle = outline.getByRole('button', { name: /^On this page/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(outline.getByRole('link', { name: 'Hold to confirm' })).toBeHidden();
  await toggle.click();
  await outline.getByRole('link', { name: 'Hold to confirm' }).click();
  await expect(
    docs(page).getByRole('heading', { name: 'Hold to confirm', level: 2 }),
  ).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(sheet(page)).toBeVisible();
  await expect(contents(page)).toBeHidden();
  await expect(toggle).toBeHidden();
  await expect(outline.getByRole('link', { name: 'Hold to confirm' })).toBeVisible();
});
