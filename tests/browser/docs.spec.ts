import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const docs = (page: Page) => page.getByRole('main', { name: 'Docs' });
const pageTitle = (page: Page) => docs(page).getByRole('heading', { level: 1 });
const guideNav = (page: Page) => docs(page).getByRole('navigation', { name: 'Guide pages' });
const article = (page: Page) => docs(page).getByRole('article');
const typeBadge = (page: Page) => article(page).locator('.docs-crumb .docs-type');

async function openDocs(page: Page) {
  await page.goto('/');
  const more = rail(page).getByRole('button', { name: /^More/ });
  await expect(rail(page).getByRole('button', { name: 'Home' })).toBeVisible();
  if (await more.isVisible()) await more.click();
  await rail(page).getByRole('button', { name: 'Docs' }).click();
  await expect(pageTitle(page)).toHaveText('What do you want to do?');
}

test('Docs opens on a short list of tasks, and a task opens its how-to with a deep link', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('spark-outpost.theme', 'system'));
  await page.emulateMedia({ colorScheme: 'light' });
  await openDocs(page);
  await expect(rail(page).getByRole('button', { name: 'Docs' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(typeBadge(page)).toHaveText('Get started');
  await expect(
    article(page).getByRole('heading', { name: 'Work in a chat', level: 2 }),
  ).toBeVisible();
  await expect(article(page).getByRole('heading', { level: 2 })).toHaveCount(4);
  expect(await article(page).locator('.docs-body li a').count()).toBeLessThanOrEqual(12);

  await article(page).getByRole('link', { name: 'Answer an approval card' }).click();
  await expect(pageTitle(page)).toHaveText('Answer an approval card');
  await expect(pageTitle(page)).toBeFocused();
  await expect(page).toHaveURL(/#\/docs\/answer-approvals$/);
  await expect(typeBadge(page)).toHaveText('How-to');
  await expect(
    guideNav(page).getByRole('link', { name: 'Answer an approval card' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(article(page).getByText('**Next:**')).toHaveCount(0);

  const shot = docs(page).getByRole('img', { name: /approval card asking to run a command/ });
  await shot.scrollIntoViewIfNeeded();
  await expect(shot).toBeVisible();
  expect(await shot.getAttribute('src')).toContain('approvals-command-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(shot).toHaveAttribute('src', /approvals-command-dark/);

  await docs(page)
    .getByRole('navigation', { name: 'On this page' })
    .getByRole('link', {
      name: 'Hold to confirm',
    })
    .click();
  await expect(
    docs(page).getByRole('heading', { name: 'Hold to confirm', level: 2 }),
  ).toBeFocused();
  await expect(page).toHaveURL(/#\/docs\/answer-approvals#hold-to-confirm$/);

  const pager = docs(page).getByRole('navigation', { name: 'More pages' });
  await expect(pager.getByRole('link', { name: /^Previous/ })).toContainText(
    'Follow, stop and queue messages',
  );
  await pager.getByRole('link', { name: /^Next/ }).click();
  await expect(pageTitle(page)).toHaveText('Plan before building');

  await page.goBack();
  await expect(pageTitle(page)).toHaveText('Answer an approval card');
  await page.reload();
  await expect(pageTitle(page)).toHaveText('Answer an approval card');

  await rail(page).getByRole('button', { name: /^Home/ }).click();
  await expect(page).not.toHaveURL(/#\/docs/);
  await page.goto('/#/docs/jev#what-it-costs');
  await expect(docs(page).getByRole('heading', { name: 'What it costs' })).toBeFocused();
  await expect(typeBadge(page)).toHaveText('Concept');
});

test('a link to a missing heading opens its page, and a missing page opens the landing page', async ({
  page,
}) => {
  await page.goto('/#/docs/answer-approvals#no-such-heading');
  await expect(pageTitle(page)).toHaveText('Answer an approval card');
  await expect(page).toHaveURL(/#\/docs\/answer-approvals$/);

  await page.goto('/#/docs/no-such-page');
  await expect(pageTitle(page)).toHaveText('What do you want to do?');
});

test('the contents open one product area at a time and keep the current one open', async ({
  page,
}) => {
  await openDocs(page);
  const started = guideNav(page).getByRole('button', { name: /^Get started/ });
  const reference = guideNav(page).getByRole('button', { name: /^Reference/ });
  await expect(started).toHaveAttribute('aria-expanded', 'true');
  await expect(reference).toHaveAttribute('aria-expanded', 'false');
  await expect(guideNav(page).getByRole('link', { name: 'Cards' })).toBeHidden();

  await reference.focus();
  await page.keyboard.press('Enter');
  await expect(reference).toHaveAttribute('aria-expanded', 'true');
  await guideNav(page).getByRole('link', { name: 'Cards' }).click();
  await expect(pageTitle(page)).toHaveText('Cards');
  await expect(typeBadge(page)).toHaveText('Reference');
  await expect(article(page).getByRole('table').first()).toBeVisible();
  await expect(reference).toHaveAttribute('aria-expanded', 'true');

  await expect(started).toHaveAttribute('aria-expanded', 'false');
  await expect(guideNav(page).getByRole('link', { name: 'Set up Spark Outpost' })).toBeHidden();
  await started.click();
  await expect(started).toHaveAttribute('aria-expanded', 'true');
  await expect(guideNav(page).getByRole('link', { name: 'Set up Spark Outpost' })).toBeVisible();
  await reference.click();
  await expect(guideNav(page).getByRole('link', { name: 'Cards' })).toBeHidden();
});

test('Search finds a task, shows the page type and opens the matching section', async ({
  page,
}) => {
  await openDocs(page);
  const search = docs(page).getByRole('searchbox', { name: 'Search the guide' });
  await search.fill('keep files away from agents');
  const results = docs(page).getByRole('list', { name: 'Search results' });
  const first = results.getByRole('link').first();
  await expect(first).toContainText('Keep files and keys away from agents');
  await expect(first).toContainText('How-to');
  await expect(guideNav(page)).toHaveCount(0);

  await first.click();
  await expect(pageTitle(page)).toHaveText('Keep files and keys away from agents');
  await expect(search).toHaveValue('');

  await search.fill('hold to confirm');
  await search.press('Enter');
  await expect(
    docs(page).getByRole('heading', { name: 'Hold to confirm', level: 2 }),
  ).toBeFocused();

  await search.fill('provider wont connect');
  await expect(results.getByRole('link').first()).toContainText('Troubleshooting');

  await search.fill('zzzqqq');
  await expect(docs(page).getByRole('status')).toHaveText('No pages match “zzzqqq”.');
  await expect(docs(page).getByRole('link', { name: 'browse by task' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('spark-outpost.docs.missed-searches')))
    .toBe('["zzzqqq"]');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(guideNav(page)).toBeVisible();
});

test('a Settings info link opens the guide at the page for that setting', async ({ page }) => {
  await page.goto('/');
  await rail(page).getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Chats & autonomy' })
    .click();
  const settings = page.getByRole('dialog', { name: 'Chats & autonomy' });
  await settings
    .getByRole('link', { name: 'Read about How much Spark does alone in Docs' })
    .click();
  await expect(settings).toBeHidden();
  await expect(pageTitle(page)).toHaveText('Choose how much Spark does alone');
  await expect(pageTitle(page)).toBeInViewport();
  await expect(page).toHaveURL(/#\/docs\/spark-autonomy$/);
});

test('Docs works at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDocs(page);
  const contents = docs(page).getByRole('button', { name: 'Contents' });
  await expect(contents).toHaveAttribute('aria-expanded', 'false');
  await expect(guideNav(page)).toBeHidden();
  await contents.click();
  await guideNav(page).getByRole('link', { name: 'Connect an AI provider' }).click();
  await expect(pageTitle(page)).toHaveText('Connect an AI provider');
  await expect(contents).toHaveAttribute('aria-expanded', 'false');
  await expect(pageTitle(page)).toBeInViewport();
  for (const slug of ['connect-a-provider', 'cards', 'welcome']) {
    await page.goto(`/#/docs/${slug}`);
    await expect(article(page)).toHaveAttribute('data-page', slug);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, slug).toBeLessThanOrEqual(0);
    const box = await article(page).boundingBox();
    expect(box!.width, slug).toBeLessThanOrEqual(390);
  }
});
