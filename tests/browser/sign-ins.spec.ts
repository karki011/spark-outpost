import { readFileSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { chatRepo, type ChatRepo, linkedChat, resetWithAgents, send } from './project-chat-kit.ts';
import { openTestDb } from './database.ts';
import { withDesktopBrowser } from './desktop-browser.ts';
import { SERVER_LOG_DIR, SIGN_IN_FIXTURE } from './stub-config.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';
const FAKE_HOST = process.env.SPARK_FAKE_BROWSER === '1';
const { username: USERNAME, password: PASSWORD } = SIGN_IN_FIXTURE;
const SPELLINGS = [USERNAME, PASSWORD, encodeURIComponent(USERNAME), encodeURIComponent(PASSWORD)];

let repo: ChatRepo;
let name = '';

test.describe.configure({ timeout: 120_000 });

test.beforeEach(async ({ page }) => {
  await resetWithAgents();
  repo = chatRepo();
  name = path.basename(repo.root);
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => {
  repo.remove();
});

async function link(page: Page): Promise<string> {
  const response = await page.request.post('/api/projects', { data: { rootPath: repo.root } });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

async function openSignIns(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Projects' })
    .click();
  await page
    .getByRole('list', { name: 'Linked folders' })
    .getByRole('button', { name: new RegExp(`^${name}\\b`) })
    .click();
  return page.getByRole('group', { name: `Saved sign-ins in ${name}` });
}

async function everythingStored(): Promise<string> {
  const db = openTestDb();
  try {
    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
    );
    const dumps: string[] = [];
    for (const { table_name } of tables.rows) {
      const { rows } = await db.query<{ line: string }>(
        `SELECT row_to_json(stored)::text AS line FROM "${table_name}" stored`,
      );
      dumps.push(...rows.map((row) => `${table_name} ${row.line}`));
    }
    return dumps.join('\n');
  } finally {
    await db.end();
  }
}

function serverLogs(): string {
  return ['api', 'worker']
    .map((process) => readFileSync(path.join(SERVER_LOG_DIR, `${process}.log`), 'utf8'))
    .join('\n');
}

function expectNoSecret(text: string) {
  for (const spelling of SPELLINGS) expect(text).not.toContain(spelling);
}

async function shoot(page: Page, selector: string, file: string) {
  if (!SHOTS) return;
  for (const skin of ['light', 'dark']) {
    await page.evaluate((theme) => (document.documentElement.dataset.skin = theme), skin);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page
      .locator(selector)
      .first()
      .screenshot({ path: path.join(SHOTS, `${file}-${skin}.png`) });
  }
  await page.evaluate(() => (document.documentElement.dataset.skin = 'light'));
}

async function fillForm(page: Page, values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) {
    await page.getByRole('form').getByLabel(label, { exact: true }).fill(value);
  }
}

test('the web app says saved sign-ins need the Mac app', async ({ page }) => {
  await link(page);
  const block = await openSignIns(page);
  await expect(block).toContainText('Saved sign-ins are available in the Spark Outpost Mac app.');
  await expect(block.getByRole('button', { name: `Add a sign-in to ${name}` })).toBeDisabled();
});

test('Settings adds, edits and deletes a sign-in without ever showing it back @packaged', async ({
  page,
}) => {
  await withDesktopBrowser(page);
  await link(page);
  const block = await openSignIns(page);
  await expect(block).toContainText('agents never see them');
  await expect(block.getByRole('list')).toHaveCount(0);

  const add = block.getByRole('button', { name: `Add a sign-in to ${name}` });
  await add.focus();
  await page.keyboard.press('Enter');
  const form = page.getByRole('form', { name: `New sign-in for ${name}` });
  await expect(form.getByLabel('Label')).toBeFocused();
  await expect(form).toContainText('Use test accounts only.');
  await expect(form).toContainText('stored in the Mac keychain');
  await expect(form.getByLabel('Password')).toHaveAttribute('type', 'password');

  await form.getByRole('button', { name: 'Add sign-in' }).click();
  await expect(form.getByLabel('Label')).toHaveAttribute('aria-invalid', 'true');
  await expect(form).toContainText('Type the password (at least 4 characters).');
  await fillForm(page, {
    Label: 'Staging admin',
    Site: 'http://staging.example.com',
    Username: USERNAME,
    Password: PASSWORD,
  });
  await expect(form).toContainText('Plain http works only for local addresses.');
  await form.getByLabel('Site', { exact: true }).fill('https://staging.example.com/login');
  await shoot(page, '.set-builders:has(.signin-form)', 'settings-sign-in-form');
  await page.keyboard.press('Enter');

  const list = block.getByRole('list', { name: `Saved sign-ins in ${name}` });
  const item = list.getByRole('listitem');
  await expect(item).toContainText('Staging admin');
  await expect(item).toContainText('https://staging.example.com');
  await expect(item).toContainText('v•••@example.test');
  await expect(form).toHaveCount(0);
  expectNoSecret(await page.content());
  expectNoSecret(await everythingStored());

  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.set-project')
    .analyze();
  expect(axe.violations).toEqual([]);
  await shoot(page, '.set-project', 'settings-sign-ins');

  await item.getByRole('button', { name: 'Edit sign-in Staging admin' }).click();
  const edit = page.getByRole('form', { name: `Sign-in Staging admin of ${name}` });
  await expect(edit.getByLabel('Label')).toBeFocused();
  await expect(edit.getByLabel('Username')).toHaveValue('');
  await expect(edit.getByLabel('Password')).toHaveValue('');
  await expect(edit.getByLabel('Username')).toHaveAttribute(
    'placeholder',
    'Leave empty to keep v•••@example.test',
  );
  expectNoSecret(await page.content());
  const editAxe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.set-project')
    .analyze();
  expect(editAxe.violations).toEqual([]);
  await edit.getByLabel('Label').fill('Staging owner');
  await edit.getByRole('button', { name: 'Save sign-in' }).click();
  await expect(item).toContainText('Staging owner');
  await expect(item).toContainText('v•••@example.test');

  const listed = await page.request.get(`/api/projects/${await projectId(page)}/sign-ins`);
  expectNoSecret(await listed.text());

  await item.getByRole('button', { name: 'Edit sign-in Staging owner' }).click();
  const hold = page.getByRole('button', { name: 'Hold to delete Staging owner' });
  await hold.focus();
  await page.keyboard.down(' ');
  await expect(list).toHaveCount(0, { timeout: 5_000 });
  await page.keyboard.up(' ');
  expectNoSecret(await everythingStored());
  expectNoSecret(serverLogs());
});

async function saveFixtureSignIn(project: string): Promise<void> {
  const db = openTestDb();
  try {
    await db.query(
      `INSERT INTO browser_sign_ins (id, project_id, label, origin, keychain_ref)
       VALUES ($1, $2, 'Staging admin', 'http://vault.test', $3)`,
      [SIGN_IN_FIXTURE.id, project, `signin:${SIGN_IN_FIXTURE.id}`],
    );
  } finally {
    await db.end();
  }
}

async function projectId(page: Page): Promise<string> {
  const listed = await page.request.get('/api/projects');
  const project = ((await listed.json()) as { id: string; rootPath: string }[]).find(
    (candidate) => candidate.rootPath === repo.root,
  );
  return project!.id;
}

test('an agent signs in through Spark after the user allows it, and never sees the values', async ({
  page,
}) => {
  test.skip(!FAKE_HOST, 'Run with SPARK_FAKE_BROWSER=1 to give the worker a fake browser host.');
  await withDesktopBrowser(page);
  const id = await link(page);
  await saveFixtureSignIn(id);
  await linkedChat(page, repo);

  await send(page, '#build #spark spark_browser_signins');
  await expect(
    page.getByText(/"label":"Staging admin","sites":\["http:\/\/vault\.test"\]/),
  ).toBeVisible({
    timeout: 45_000,
  });

  await send(page, '#build #spark spark_browser_open {"url":"http://vault.test/login.html"}');
  await expect(page.getByText(/"outcome":"opened"/)).toBeVisible({ timeout: 45_000 });

  await send(page, '#build #spark spark_browser_sign_in {"signIn":"Staging admin"}');
  const card = page.getByRole('group', {
    name: /Sign in to http:\/\/vault\.test as Staging admin\?/,
  });
  await expect(card).toBeVisible({ timeout: 45_000 });
  await expect(card).toContainText('v•••@example.test');
  await expect(card).toContainText('The agent never sees them.');
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.sac')
    .analyze();
  expect(axe.violations).toEqual([]);
  const composer = await page.getByRole('textbox', { name: 'Message' }).boundingBox();
  const placed = await card.boundingBox();
  expect(placed!.y + placed!.height).toBeLessThanOrEqual(composer!.y + 1);
  await shoot(page, '.sac', 'sign-in-card');
  await card.getByRole('button', { name: 'Allow for this chat' }).click();
  await expect(page.getByText(/"outcome":"form_submitted"/)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/"page":"http:\/\/vault\.test\/home"/)).toBeVisible();

  await send(page, '#build #spark spark_browser_sign_in {"signIn":"Staging admin"}');
  await expect(page.getByText(/"outcome":"form_submitted"/)).toHaveCount(2, { timeout: 45_000 });
  await expect(
    page.getByRole('group', { name: /Sign in to http:\/\/vault\.test as Staging admin\?/ }),
  ).toHaveCount(1);

  await send(page, '#build #spark spark_browser_read');
  await expect(
    page.getByText(/The page repeats \[saved sign-in\] and \[saved sign-in\]/),
  ).toBeVisible({
    timeout: 45_000,
  });
  await send(page, '#build #spark spark_browser_logs');
  await expect(page.getByText(/submitted \[saved sign-in\] \[saved sign-in\]/)).toBeVisible({
    timeout: 45_000,
  });

  expectNoSecret(await page.content());
  expectNoSecret(await everythingStored());
  expectNoSecret(serverLogs());
  const stored = await everythingStored();
  expect(stored).toContain('"tool": "spark_browser_sign_in"');
  expect(stored).toMatch(/"decision": "user_allowed"/);
  expect(stored).toMatch(/"decision": "allowed_earlier"/);
});
