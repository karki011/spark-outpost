import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ModelCardsResponse } from '../../packages/contracts/src/model-cards.ts';
import { expandSection } from './provider-screen.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import {
  expectInsideViewport,
  expectNoSidewaysScroll,
  openSettings,
  openTouch,
} from './responsive-kit.ts';

const BEFORE_HAIKU_RETIRES = new Date('2026-09-29T12:00:00Z');

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'], catalog: true });
});

async function openModels(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog', { name: 'Spark' }).getByRole('tab', { name: 'Models' }).click();
  const dialog = page.getByRole('dialog', { name: 'Models' });
  await expect(dialog).toBeVisible();
  return dialog;
}

const modelRow = (scope: Locator, name: string | RegExp) =>
  scope.getByRole('row').filter({ has: scope.page().getByRole('rowheader', { name }) });

const detailsOf = async (scope: Locator, button: Locator) =>
  scope.locator(`[id="${await button.getAttribute('aria-controls')}"]`);

const rowNames = (scope: Locator) => scope.locator('tbody .mc-row .mc-name').allTextContents();

test('Models is one table per provider and a row opens for the details', async ({ page }) => {
  await page.clock.setFixedTime(BEFORE_HAIKU_RETIRES);
  const dialog = await openModels(page);
  const chips = dialog.getByRole('radiogroup', { name: 'Show models from' });
  await expect(chips.getByRole('radio', { name: /^All/ })).toBeChecked();
  const claude = dialog.getByRole('region', { name: 'Claude' });
  const codex = dialog.getByRole('region', { name: 'Codex' });
  await expect(dialog.getByRole('region', { name: 'Z.ai (GLM)' })).toContainText('not connected');
  await expect(claude.getByText('Asks before edits and commands · resumes chats')).toBeHidden();
  await expect(claude.getByText('No OS sandbox')).toBeHidden();
  await claude.getByText('About Claude').click();
  await expect(claude.getByText('Asks before edits and commands · resumes chats')).toBeVisible();
  await expect(claude.getByText(/^No OS sandbox/)).toBeVisible();
  await expect(claude.getByText('Do mode')).toBeVisible();

  const table = claude.getByRole('table', { name: /^Claude models/ });
  await expect(table.getByRole('columnheader')).toHaveText([
    'Model',
    'Tier',
    'Price per 1M tokens',
    'Context / max output',
    'Speed',
    'Effort',
    'Knowledge',
    'Passed',
    'In',
    'Cached',
    'Out',
  ]);
  await expect(table.getByRole('rowheader')).toHaveText([
    'Spark picks from these',
    /^Sonnet 5(?!\.)/,
    /^Sonnet 5\.5/,
    /^Opus 5\.5/,
    'Only when you pick it',
    /^Haiku 5\.5/,
    /^Haiku 4\.5/,
    /^Fable 5\.1/,
  ]);

  const sonnet = modelRow(table, /^Sonnet 5 /);
  await expect(sonnet.getByRole('cell')).toHaveText([
    'mid',
    '$2',
    '$0.2',
    '$10',
    /^1M \/ \d+K$/,
    'fast',
    'low–max',
    '2026-01',
    /^\d+\/\d+/,
  ]);
  const details = sonnet.getByRole('button', { name: /^Sonnet 5 / });
  await expect(details).toHaveText('Sonnet 5Everyday Builder, Critic, answers');
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  const measured = table.getByRole('table', { name: 'Measured on our benchmark' });
  await expect(measured).toBeHidden();
  await details.focus();
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('aria-expanded', 'true');
  const opened = await detailsOf(table, details);
  const facts = opened.locator('.mc-facts');
  await expect(facts.getByText('mid', { exact: true })).toBeVisible();
  await expect(facts).toContainText('$2 in · $0.2 cached · $10 out per million tokens');
  await expect(facts).toContainText(/1M · \d+K max output/);
  await expect(facts).toContainText(/Effortlow–max \(default \w+\)/);
  await expect(facts).toContainText('Knowledge2026-01');
  await expect(facts).toContainText('Retires 2027-06-30');
  await expect(facts).toContainText(/\d+\/\d+ passed Best at .+, \$[\d.]+ mean/);
  await expect(measured).toContainText('fix alone · medium');
  await expect(opened.getByRole('heading', { name: 'Good at' })).toBeVisible();
  await expect(opened.getByRole('link').first()).toHaveAttribute('href', /^https:/);
  await expect(opened).toContainText(/checked \d{4}-\d{2}-\d{2}/);
  await page.keyboard.press('Enter');
  await expect(measured).toBeHidden();

  await expect(modelRow(table, 'Opus 5.5').getByRole('rowheader')).toContainText('default');
  const haiku = modelRow(table, 'Haiku 4.5');
  await expect(haiku.getByRole('rowheader')).toContainText('Retiring Oct 15');
  await expect(haiku.getByRole('cell').nth(6)).toHaveText('none');
  const fable = modelRow(table, 'Fable 5.1');
  await expect(fable.getByRole('rowheader')).toContainText('not offered');
  await expect(fable.getByRole('cell').first()).toHaveText('frontier');
  await expect(fable.getByRole('cell').last()).toHaveText('—');
  const fableDetails = fable.getByRole('button', { name: /^Fable/ });
  await fableDetails.click();
  await expect(await detailsOf(table, fableDetails)).toContainText('Not benchmarked');

  const sol = modelRow(codex, 'GPT-6 Sol');
  const solDetails = sol.getByRole('button', { name: /^GPT-6 Sol/ });
  await expect(solDetails).toContainText('default');
  await expect(sol.getByRole('cell').last()).toContainText('anecdotal');
  await solDetails.focus();
  await page.keyboard.press('Enter');
  const solOpened = await detailsOf(codex, solDetails);
  await expect(solOpened.getByRole('table')).toContainText('anecdotal');
  const summary = solOpened.getByText('What Jev reads');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(solOpened.locator('.mc-more code')).toHaveText(
    /^GPT-6 Sol: mid tier, fast, \$2\/\$10 per M/,
  );
  await expect(solOpened.locator('.mc-more')).toContainText('of 160 characters');
});

test('price and tier headers sort every table inside its groups', async ({ page }) => {
  const dialog = await openModels(page);
  const claude = dialog.getByRole('region', { name: 'Claude' });
  const codex = dialog.getByRole('region', { name: 'Codex' });
  const out = claude.getByRole('columnheader', { name: 'Out', exact: true });
  const sortOut = out.getByRole('button', { name: 'Out', exact: true });
  await expect(out).not.toHaveAttribute('aria-sort');
  expect(await rowNames(claude)).toEqual([
    'Sonnet 5',
    'Sonnet 5.5',
    'Opus 5.5',
    'Haiku 5.5',
    'Haiku 4.5',
    'Fable 5.1',
  ]);

  await sortOut.focus();
  await page.keyboard.press('Enter');
  await expect(out).toHaveAttribute('aria-sort', 'ascending');
  await expect(sortOut).toBeFocused();
  expect(await rowNames(claude)).toEqual([
    'Sonnet 5',
    'Sonnet 5.5',
    'Opus 5.5',
    'Haiku 5.5',
    'Haiku 4.5',
    'Fable 5.1',
  ]);

  await page.keyboard.press('Enter');
  await expect(out).toHaveAttribute('aria-sort', 'descending');
  expect(await rowNames(claude)).toEqual([
    'Opus 5.5',
    'Sonnet 5',
    'Sonnet 5.5',
    'Fable 5.1',
    'Haiku 4.5',
    'Haiku 5.5',
  ]);
  await expect(codex.getByRole('columnheader', { name: 'Out', exact: true })).toHaveAttribute(
    'aria-sort',
    'descending',
  );
  expect((await rowNames(codex)).slice(0, 3)).toEqual([
    'GPT-5.6 Sol',
    'GPT-5.6 Terra',
    'GPT-6 Sol',
  ]);

  const tier = claude.getByRole('columnheader', { name: 'Tier' });
  await tier.getByRole('button').click();
  await expect(tier).toHaveAttribute('aria-sort', 'ascending');
  await expect(out).not.toHaveAttribute('aria-sort');
  await tier.getByRole('button').click();
  await tier.getByRole('button').click();
  await expect(tier).not.toHaveAttribute('aria-sort');
  expect(await rowNames(claude)).toEqual([
    'Sonnet 5',
    'Sonnet 5.5',
    'Opus 5.5',
    'Haiku 5.5',
    'Haiku 4.5',
    'Fable 5.1',
  ]);
});

test('a model the agent offers without a card is a row marked No details yet', async ({ page }) => {
  await page.route('**/api/model-cards', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as ModelCardsResponse;
    const codex = body.providers.find((view) => view.provider.provider === 'codex')!;
    codex.uncardedModels = [{ id: 'gpt-7-nova', label: 'GPT-7 Nova' }];
    await route.fulfill({ response, json: body });
  });
  const dialog = await openModels(page);
  const codex = dialog.getByRole('region', { name: 'Codex' });
  await expect(
    dialog.getByRole('radiogroup').getByRole('radio', { name: /^Codex\s*8 models$/ }),
  ).toBeVisible();
  await expect(codex.getByRole('rowheader', { name: 'No card yet' })).toBeVisible();
  const nova = modelRow(codex, 'GPT-7 Nova');
  await expect(nova.getByRole('rowheader')).toHaveText('GPT-7 NovaNo details yet');
  await expect(nova.getByRole('button')).toHaveCount(0);
  await expect(nova.getByRole('cell')).toHaveText(Array.from({ length: 9 }, () => '—'));
  await expect(codex.getByRole('note')).toContainText('No card for GPT-7 Nova');
  await codex.getByRole('columnheader', { name: 'Out', exact: true }).getByRole('button').click();
  expect((await rowNames(codex)).at(-1)).toBe('GPT-7 Nova');
});

test('at 375px the table scrolls inside its own box and the page does not', async ({ browser }) => {
  const page = await openTouch(browser, { width: 375, height: 812 }, 'chats');
  const settings = await openSettings(page, true);
  await settings.getByRole('tab', { name: 'Models' }).click();
  const dialog = page.getByRole('dialog', { name: 'Models' });
  const claude = dialog.getByRole('region', { name: 'Claude' });
  const scroller = claude.locator('.dt-scroll');
  await expect(claude.getByRole('table', { name: /^Claude models/ })).toBeVisible();
  await expectNoSidewaysScroll(page);
  expect(await scroller.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);

  const sonnet = claude.getByRole('button', { name: /^Sonnet 5 / });
  await sonnet.click();
  const facts = (await detailsOf(claude, sonnet)).locator('.mc-facts');
  await expect(facts).toBeVisible();
  await scroller.evaluate((node) => node.scrollTo({ left: node.scrollWidth }));
  await expect(
    scroller.locator('.dt > thead').getByRole('columnheader', { name: 'Passed' }),
  ).toBeInViewport();
  await expectInsideViewport(page, sonnet);
  await expectInsideViewport(page, facts);
  await expectNoSidewaysScroll(page);
  await page.context().close();
});

test('provider chips filter the cards, work from the keyboard and are remembered', async ({
  page,
}) => {
  const dialog = await openModels(page);
  const chips = dialog.getByRole('radiogroup', { name: 'Show models from' });
  const regions = dialog.getByRole('region');
  await expect(regions).toHaveCount(3);
  await expect(chips.getByRole('radio', { name: /^Claude\s*6 models$/ })).toBeVisible();

  await chips.getByRole('radio', { name: /^Codex/ }).click();
  await expect(chips.getByRole('radio', { name: /^Codex/ })).toBeChecked();
  await expect(regions).toHaveCount(1);
  await expect(dialog.getByRole('region', { name: 'Codex' })).toBeVisible();

  await page.keyboard.press('ArrowRight');
  const zai = chips.getByRole('radio', { name: /^Z\.ai/ });
  await expect(zai).toBeChecked();
  await expect(zai).toBeFocused();
  await expect(dialog.getByRole('region', { name: 'Z.ai (GLM)' })).toBeVisible();
  await expect(regions).toHaveCount(1);

  const codex = dialog.getByRole('region', { name: 'Codex' });
  await page.keyboard.press('ArrowLeft');
  await expect(codex).toBeVisible();
  expect((await rowNames(codex)).at(0)).toBe('GPT-6 Sol');
  expect((await rowNames(codex)).at(-1)).toBe('GPT-6 Astra');

  await page.reload();
  const again = await openModels(page);
  const againChips = again.getByRole('radiogroup', { name: 'Show models from' });
  await expect(againChips.getByRole('radio', { name: /^Codex/ })).toBeChecked();
  await expect(again.getByRole('region')).toHaveCount(1);
  await againChips.getByRole('radio', { name: /^Codex/ }).focus();
  await page.keyboard.press('Home');
  await expect(againChips.getByRole('radio', { name: /^All/ })).toBeChecked();
  await expect(again.getByRole('region')).toHaveCount(3);
});

test('the rules pick models, so there is no frontier switch, and Jev can stop checking changes', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'], jev: true });
  const dialog = await openModels(page);
  await expect(dialog.getByRole('switch', { name: /Allow frontier models/ })).toHaveCount(0);
  await expect(dialog).toContainText('The rules pick models');

  await dialog.getByRole('tab', { name: /AI providers/ }).click();
  const providers = page.getByRole('dialog', { name: 'AI providers' });
  await providers.locator('.ptile[data-prov="jev"]').click();
  await expandSection(providers.locator('.pconf[data-prov="jev"]'), 'Settings');
  const diffs = providers.getByRole('switch', { name: 'Check changes with Jev' });
  await expect(diffs).toBeChecked();
  await expect(diffs).toHaveAccessibleDescription(
    'Diffs and short file previews go to TypeSafe and are never used for training.',
  );
  const info = providers.getByRole('button', { name: 'More about Check changes with Jev' });
  await expect(info).toHaveAccessibleDescription(
    /observation only.*a stronger model redoes it once/,
  );
  await diffs.focus();
  await page.keyboard.press('Space');
  await expect(diffs).not.toBeChecked();
  await page.reload();
  await expect(
    page
      .getByRole('dialog', { name: 'AI providers' })
      .getByRole('switch', { name: 'Check changes with Jev' }),
  ).not.toBeChecked();
});
