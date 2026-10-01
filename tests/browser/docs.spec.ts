import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const docs = (page: Page) => page.getByRole('main', { name: 'Docs' });
const pageTitle = (page: Page) => docs(page).getByRole('heading', { level: 1 });
const guideNav = (page: Page) => docs(page).getByRole('navigation', { name: 'Guide pages' });

async function openDocs(page: Page) {
  await page.goto('/');
  await rail(page).getByRole('button', { name: 'Docs' }).click();
  await expect(pageTitle(page)).toHaveText('Getting started');
}

test('Docs opens from the rail, moves between pages and keeps a deep link per page', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('spark-outpost.theme', 'system'));
  await page.emulateMedia({ colorScheme: 'light' });
  await openDocs(page);
  await expect(rail(page).getByRole('button', { name: 'Docs' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(guideNav(page).getByRole('heading', { name: 'Stay in control' })).toBeVisible();
  await expect(guideNav(page).getByRole('link', { name: /^Guardrails/ })).toContainText('Soon');

  await guideNav(page).getByRole('link', { name: 'Approvals and protected paths' }).click();
  await expect(pageTitle(page)).toHaveText('Approvals and protected paths');
  await expect(pageTitle(page)).toBeFocused();
  await expect(page).toHaveURL(/#\/docs\/approvals$/);
  await expect(
    guideNav(page).getByRole('link', { name: 'Approvals and protected paths' }),
  ).toHaveAttribute('aria-current', 'page');
  const shot = docs(page).getByRole('img', { name: /approval card asking to run a command/ });
  await shot.scrollIntoViewIfNeeded();
  await expect(shot).toBeVisible();
  expect(await shot.getAttribute('src')).toContain('approvals-command-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(shot).toHaveAttribute('src', /approvals-command-dark/);

  await docs(page).getByRole('link', { name: 'Spark autonomy' }).first().click();
  await expect(pageTitle(page)).toHaveText('Chats, modes and autonomy');
  await expect(docs(page).getByRole('heading', { name: 'Spark autonomy', level: 2 })).toBeFocused();

  await page.goBack();
  await expect(pageTitle(page)).toHaveText('Approvals and protected paths');

  await docs(page).getByRole('link', { name: /^Next/ }).click();
  await expect(pageTitle(page)).toHaveText('Privacy and secrets');
  await expect(docs(page).getByRole('heading', { name: 'Where your keys live' })).toBeVisible();

  await page.reload();
  await expect(pageTitle(page)).toHaveText('Privacy and secrets');

  await rail(page).getByRole('button', { name: /^Home/ }).click();
  await expect(page).not.toHaveURL(/#\/docs/);
  await page.goto('/#/docs/jev#what-it-costs');
  await expect(docs(page).getByRole('heading', { name: 'What it costs' })).toBeFocused();
});

test('Search finds titles, headings and text and opens the matching section', async ({ page }) => {
  await openDocs(page);
  const search = docs(page).getByRole('searchbox', { name: 'Search the guide' });
  await search.fill('sparkignore');
  const results = docs(page).getByRole('list', { name: 'Search results' });
  await expect(results.getByRole('link').first()).toBeVisible();
  await expect(guideNav(page)).toHaveCount(0);
  await expect(results).toContainText('Approvals and protected paths');

  await results.getByRole('link', { name: /Approvals and protected paths/ }).click();
  await expect(pageTitle(page)).toHaveText('Approvals and protected paths');
  await expect(
    docs(page).getByRole('heading', { name: 'Keep files away from agents with .sparkignore' }),
  ).toBeFocused();
  await expect(search).toHaveValue('');

  await search.fill('hold to confirm');
  await search.press('Enter');
  await expect(
    docs(page).getByRole('heading', { name: 'Hold to confirm', level: 2 }),
  ).toBeFocused();

  await search.fill('zzzqqq');
  await expect(docs(page).getByRole('status')).toHaveText('No pages match “zzzqqq”.');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(guideNav(page)).toBeVisible();
});

test('a Settings info link opens the guide at the right heading', async ({ page }) => {
  await page.goto('/');
  await rail(page).getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Spark' });
  await settings
    .getByRole('link', { name: 'Read about How much Spark does alone in Docs' })
    .click();
  await expect(settings).toBeHidden();
  await expect(pageTitle(page)).toHaveText('Chats, modes and autonomy');
  const heading = docs(page).getByRole('heading', { name: 'Spark autonomy', level: 2 });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  await expect(page).toHaveURL(/#\/docs\/chats-and-modes#spark-autonomy$/);
});

test('Docs works at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDocs(page);
  const contents = docs(page).getByRole('button', { name: 'Contents' });
  await expect(contents).toHaveAttribute('aria-expanded', 'false');
  await expect(guideNav(page)).toBeHidden();
  await contents.click();
  await guideNav(page).getByRole('link', { name: 'Chats, modes and autonomy' }).click();
  await expect(pageTitle(page)).toHaveText('Chats, modes and autonomy');
  await expect(contents).toHaveAttribute('aria-expanded', 'false');
  await expect(pageTitle(page)).toBeInViewport();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const article = await docs(page).locator('.docs-article').boundingBox();
  expect(article!.width).toBeLessThanOrEqual(390);
});
