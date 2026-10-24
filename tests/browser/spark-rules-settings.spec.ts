import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  acceptedOf,
  acceptedRecordPath,
  acceptedRecordText,
} from '../../apps/server/src/spark-rules/accepted.ts';
import { resetTestDatabase } from './database.ts';
import { SPARK_MANAGED_RULES_FILE, SPARK_RULES_DIR, SPARK_RULES_FILE } from './stub-config.ts';

async function openSparkRules(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Spark rules' })
    .click();
  return page.getByRole('dialog', { name: 'Spark rules' });
}

interface RulesFile {
  theme?: string;
  permissions: { allow: string[]; ask: string[]; deny: string[] };
}

const userFile = () => JSON.parse(readFileSync(SPARK_RULES_FILE, 'utf8')) as RulesFile;

function writeRules(file: string, value: unknown) {
  mkdirSync(SPARK_RULES_DIR, { recursive: true });
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  writeFileSync(file, text);
  if (file !== SPARK_RULES_FILE) return;
  const record = acceptedRecordText(acceptedOf({ kind: 'text', text }));
  writeFileSync(acceptedRecordPath(file), record);
}

const savedRule = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/spark-rules/rule') && response.request().method() === 'PUT',
  );

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('every rule shows its choice and changing one writes settings.json', async ({ page }) => {
  await page.goto('/');
  const settings = await openSparkRules(page);
  await expect(
    settings.getByText("Nothing set means the agent's mode decides, like any other tool."),
  ).toBeVisible();
  for (const group of ['Publishing', 'GitHub commands', 'Files', 'Sending']) {
    await expect(settings.getByRole('heading', { name: group })).toBeVisible();
  }
  await expect(settings.getByRole('button', { name: 'Use recommended rules' })).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Open settings.json' })).toHaveCount(0);

  const force = settings.getByRole('button', { name: 'Force push', exact: true });
  await expect(force).toHaveText('Ask, hold to confirm');
  await expect(settings.getByRole('button', { name: 'Push any other branch' })).toHaveText(
    'Refuse',
  );
  await expect(settings.getByRole('button', { name: 'Merge a pull request' })).toHaveText('Refuse');
  await expect(settings.getByText(/Asked means your message asks/)).toBeVisible();
  await expect(
    settings.getByText("Always kept, so an agent can't give itself more", { exact: false }),
  ).toBeVisible();

  await force.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Force push' });
  await expect(menu.getByRole('menuitemradio', { name: /^Allow/ })).toHaveCount(0);
  await expect(menu.getByRole('menuitemradio', { name: /Ask, hold to confirm/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitemradio', { name: /Refuse/ })).toBeFocused();
  const saved = savedRule(page);
  await page.keyboard.press('Enter');
  await saved;
  await expect(force).toHaveText('Refuse');
  await expect(force).toBeFocused();
  expect(userFile().permissions.deny).toContain('Push(force)');
  expect(userFile().permissions.ask).not.toContain('Push(force)');

  const workflows = settings.getByRole('button', { name: 'Run a workflow' });
  await workflows.click();
  const toMode = savedRule(page);
  await page
    .getByRole('menu', { name: 'Run a workflow' })
    .getByRole('menuitemradio', { name: /Agent's mode/ })
    .click();
  await toMode;
  await expect(workflows).toHaveText("Agent's mode");
  expect(JSON.stringify(userFile())).not.toContain('workflow run');
});

test('an edit made in the file shows when the page gets focus again', async ({ page }) => {
  writeRules(SPARK_RULES_FILE, { permissions: { allow: [], ask: [], deny: ['GitRemote'] } });
  await page.goto('/');
  const settings = await openSparkRules(page);
  const remotes = settings.getByRole('button', { name: 'Change remotes or publish another way' });
  await expect(remotes).toHaveText('Refuse');
  await expect(
    settings.getByRole('button', { name: "Push the chat's branch without being asked" }),
  ).toHaveText("Agent's mode");
  writeRules(SPARK_RULES_FILE, {
    theme: 'dark',
    permissions: { allow: ['Bash(npm test)'], ask: [], deny: [] },
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(remotes).toHaveText("Agent's mode");
  const unused = settings.getByRole('region', { name: "2 entries in your file aren't used" });
  await expect(unused).toContainText('"theme": "dark"');
  await expect(unused).toContainText('Unknown key');
  await expect(unused).toContainText("Agent tool rule: put it in Claude's settings");
});

test('rules past the limit are reported while the page stays editable', async ({ page }) => {
  const many = Array.from({ length: 201 }, (_, index) => `Gh(release v${index})`);
  writeRules(SPARK_RULES_FILE, { permissions: { allow: [], ask: [], deny: many } });
  await page.goto('/');
  const settings = await openSparkRules(page);
  await expect(settings.getByRole('alert')).toContainText(
    'settings.json: deny holds more than 200 rules; the rest are not applied.',
  );
  await expect(settings.getByRole('button', { name: 'Use recommended rules' })).toBeEnabled();
});

test('a rule the company file sets is locked', async ({ page }) => {
  writeRules(SPARK_MANAGED_RULES_FILE, { permissions: { deny: ['WriteOutside'] } });
  await page.goto('/');
  const settings = await openSparkRules(page);
  await expect(settings.getByText('Your company')).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Write outside the project' })).toHaveCount(0);
  const blocked = await page.request.put('/api/spark-rules/rule', {
    data: { row: 'WriteOutside', choice: 'allow' },
  });
  expect(blocked.status()).toBe(400);
});

test('a broken settings.json is reported and nothing can be changed', async ({ page }) => {
  writeRules(SPARK_RULES_FILE, '{ broken');
  await page.goto('/');
  const settings = await openSparkRules(page);
  await expect(settings.getByRole('alert')).toContainText("settings.json can't be used.");
  await expect(settings.getByRole('alert')).toContainText('recommended rules');
  await expect(settings.getByRole('button', { name: 'Use recommended rules' })).toBeDisabled();
  await expect(settings.getByRole('button', { name: 'Push any other branch' })).toHaveCount(0);
  await expect(settings.getByText('Refuse').first()).toBeVisible();
});

test('Use recommended rules asks first and keeps the rest of the file @packaged', async ({
  page,
}) => {
  writeRules(SPARK_RULES_FILE, {
    theme: 'dark',
    permissions: { allow: ['Gh(release create)', 'Push(force)'], ask: [], deny: [] },
  });
  await page.goto('/');
  const settings = await openSparkRules(page);
  const button = settings.getByRole('button', { name: 'Use recommended rules' });
  await button.click();
  const dialog = page.getByRole('alertdialog', { name: 'Use recommended rules?' });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();

  await button.click();
  await dialog.getByRole('button', { name: 'Use recommended rules' }).click();
  await expect(settings.getByText('Recommended rules are in settings.json.')).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Force push', exact: true })).toHaveText(
    'Ask, hold to confirm',
  );
  const file = userFile();
  expect(file.theme).toBe('dark');
  expect(file.permissions.allow).toContain('Gh(release create)');
  expect(file.permissions.deny).toContain('Gh(*)');
});

test('allowed gh commands take gh prefixes, send the ones with their own rule to that row, and can be removed', async ({
  page,
}) => {
  await page.goto('/');
  const settings = await openSparkRules(page);
  const input = settings.getByRole('textbox', { name: 'Allowed gh commands' });
  const add = settings.getByRole('button', { name: 'Add', exact: true });

  await input.fill('gh pr merge');
  await add.click();
  await expect(settings.getByText('Merging has its own rule: Merge a pull request.')).toBeVisible();
  await expect(input).toHaveAttribute('aria-invalid', 'true');

  await input.fill('  GH release   create ');
  await input.press('Enter');
  const list = settings.getByRole('list', { name: 'Allowed gh commands' });
  await expect(list.getByText('gh release create')).toBeVisible();
  await expect(list.getByText('Gh(release create)')).toBeVisible();
  await expect(input).toHaveValue('');
  expect(userFile().permissions.allow).toContain('Gh(release create)');

  await settings.getByRole('button', { name: 'Remove gh release create' }).click();
  await expect(list).toHaveCount(0);
  await expect.poll(() => userFile().permissions.allow).not.toContain('Gh(release create)');
});

test("with no rules file every rule shows the agent's mode until one is set", async ({ page }) => {
  await resetTestDatabase({ onboarded: true, sparkRules: 'none' });
  await page.goto('/');
  const settings = await openSparkRules(page);
  const pickers = settings.locator('.rules-choice .field-button');
  await expect(pickers).toHaveCount(18);
  for (const picker of await pickers.all()) await expect(picker).toHaveText("Agent's mode");
  await expect(settings.getByText('Your file')).toHaveCount(0);
  expect(existsSync(SPARK_RULES_FILE)).toBe(false);

  await settings.getByRole('button', { name: 'Use recommended rules' }).click();
  await page
    .getByRole('alertdialog', { name: 'Use recommended rules?' })
    .getByRole('button', { name: 'Use recommended rules' })
    .click();
  await expect(settings.getByRole('button', { name: 'Merge a pull request' })).toHaveText('Refuse');
  expect(userFile().permissions.deny).toEqual(
    expect.arrayContaining([
      'Gh(pr merge)',
      'Gh(pr review)',
      'GhAdmin',
      'Gh(auth)',
      'Gh(api write)',
    ]),
  );
});
