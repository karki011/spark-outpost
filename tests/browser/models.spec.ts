import { expect, test, type Page } from '@playwright/test';
import { expandSection } from './provider-screen.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

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

test('Models lists one compact row per model and opens it for the details', async ({ page }) => {
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
  await expect(dialog.getByRole('radiogroup', { name: 'Sort models by' })).toHaveCount(0);

  const picked = claude.getByRole('list', { name: 'Spark picks from these' });
  await expect(picked.getByRole('listitem')).toHaveText([/^Sonnet 5/, /^Opus 5\.5/]);
  const manual = claude.getByRole('list', { name: 'Only when you pick it' });
  await expect(manual.getByRole('listitem')).toHaveText([/^Haiku 4\.5/, /^Fable 5\.1/]);

  const sonnet = claude.getByRole('listitem', { name: 'Sonnet 5', exact: true });
  const details = sonnet.getByRole('button', { name: /^Sonnet 5/ });
  await expect(details).toHaveText('Sonnet 5Everyday Builder, Critic, answers');
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  await expect(sonnet.getByText('$2 in · $0.2 cached · $10 out per million tokens')).toBeHidden();
  const table = sonnet.getByRole('table', { name: 'Measured on our benchmark' });
  await expect(table).toBeHidden();
  await details.focus();
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('aria-expanded', 'true');
  const facts = sonnet.locator('.mc-facts');
  await expect(facts.getByText('mid', { exact: true })).toBeVisible();
  await expect(facts).toContainText('$2 in · $0.2 cached · $10 out per million tokens');
  await expect(facts).toContainText(/1M · \d+K max output/);
  await expect(facts).toContainText(/Effortlow–max \(default \w+\)/);
  await expect(facts).toContainText('Retires 2027-06-30');
  await expect(facts).toContainText(/\d+\/\d+ passed Best at .+, \$[\d.]+ mean/);
  await expect(table).toContainText('fix alone · medium');
  await expect(sonnet.getByRole('heading', { name: 'Good at' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(table).toBeHidden();

  const opus = claude.getByRole('listitem', { name: 'Opus 5.5', exact: true });
  await expect(opus.getByRole('button', { name: /^Opus 5\.5/ })).toContainText('default');
  const haiku = claude.getByRole('listitem', { name: 'Haiku 4.5', exact: true });
  await expect(haiku.getByRole('button', { name: /^Haiku/ })).toContainText('Retiring Oct 15');
  await expect(haiku).toContainText('Spark no longer picks it');
  const fable = claude.getByRole('listitem', { name: 'Fable 5.1', exact: true });
  await expect(fable.getByRole('button', { name: /^Fable/ })).toContainText('not offered');
  await fable.getByRole('button', { name: /^Fable/ }).click();
  await expect(fable.locator('.mc-facts')).toContainText('frontier');
  await expect(fable.locator('.mc-facts')).toContainText('Not benchmarked');

  const sol = codex.getByRole('listitem', { name: 'GPT-6 Sol', exact: true });
  const solDetails = sol.getByRole('button', { name: /^GPT-6 Sol/ });
  await expect(solDetails).toContainText('default');
  await solDetails.focus();
  await page.keyboard.press('Enter');
  await expect(sol.getByRole('table')).toContainText('anecdotal');
  const summary = sol.getByText('What Jev reads');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(sol.locator('.mc-more code')).toHaveText(
    /^GPT-6 Sol: mid tier, fast, \$2\/\$10 per M/,
  );
  await expect(sol.locator('.mc-more')).toContainText('of 160 characters');
});

test('the first and last rows of a model list follow its rounded corners', async ({ page }) => {
  const dialog = await openModels(page);
  const list = dialog
    .getByRole('region', { name: 'Claude' })
    .getByRole('list', { name: 'Only when you pick it' });
  const corners = (name: RegExp) =>
    list.getByRole('button', { name }).evaluate((button) => {
      const style = getComputedStyle(button);
      const listStyle = getComputedStyle(button.closest('ul')!);
      return {
        top: style.borderTopLeftRadius === listStyle.borderTopLeftRadius,
        bottom: style.borderBottomRightRadius === listStyle.borderBottomRightRadius,
        square: style.borderBottomRightRadius === '0px',
      };
    });
  expect(await corners(/^Haiku/)).toEqual({ top: true, bottom: false, square: true });
  expect(await corners(/^Fable/)).toMatchObject({ bottom: true, square: false });
  await list.getByRole('button', { name: /^Fable/ }).focus();
  expect(await corners(/^Fable/)).toMatchObject({ bottom: true });
  await page.keyboard.press('Enter');
  expect(await corners(/^Fable/)).toMatchObject({ square: true });
});

test('provider chips filter the cards, work from the keyboard and are remembered', async ({
  page,
}) => {
  const dialog = await openModels(page);
  const chips = dialog.getByRole('radiogroup', { name: 'Show models from' });
  const regions = dialog.getByRole('region');
  await expect(regions).toHaveCount(3);
  await expect(chips.getByRole('radio', { name: /^Claude\s*4 models$/ })).toBeVisible();

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
  await expect(codex.getByRole('listitem').first()).toHaveAccessibleName('GPT-6 Sol');
  await expect(codex.getByRole('listitem').last()).toHaveAccessibleName('GPT-6 Astra');

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
