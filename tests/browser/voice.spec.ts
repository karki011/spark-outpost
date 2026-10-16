import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { emitVoice, installFakeVoice, press, say, voiceCalls } from './fake-voice.ts';
import { seedChats } from './sidebar-seed.ts';
import { connectTickets, resetTicketFakes } from './ticket-seed.ts';

let base = '';

test.beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-voice-')));
  mkdirSync(path.join(base, 'feature-web-apps'));
});

test.afterAll(() => rmSync(base, { recursive: true, force: true }));

const island = (page: Page) => page.getByRole('region', { name: 'Spark Island' });

async function userMessages(): Promise<number> {
  const db = openTestDb();
  try {
    const result = await db.query(`SELECT count(*)::int AS n FROM messages WHERE role = 'user'`);
    return result.rows[0].n as number;
  } finally {
    await db.end();
  }
}

async function openIsland(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  await expect(island(page)).toBeVisible();
}

async function linkProject(page: Page) {
  const response = await page.request.post('/api/projects', {
    data: { rootPath: path.join(base, 'feature-web-apps') },
  });
  expect(response.ok()).toBe(true);
}

test('Voice is not offered without the Mac app', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Profile & personality' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Voice' })).toHaveCount(0);
});

test('Settings: Voice starts off, Speak answers starts off, turning on asks the Mac', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await installFakeVoice(page, { enabled: false });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Voice' }).click();
  const settings = page.getByRole('dialog', { name: 'Voice' });
  const voice = settings.getByRole('switch', { name: 'Voice', exact: true });
  await expect(voice).not.toBeChecked();
  await expect(settings.getByText('Off. Spark never listens.')).toBeVisible();
  await expect(settings.getByRole('switch', { name: 'Speak answers' })).not.toBeChecked();
  await expect(settings.getByRole('switch', { name: 'Speak answers' })).toBeDisabled();
  await voice.focus();
  await page.keyboard.press('Space');
  await expect(voice).toBeChecked();
  await expect(settings.getByRole('region', { name: 'Microphone and speech model' })).toContainText(
    'Ready',
  );
  await settings.getByRole('radio', { name: 'Use Fn twice' }).check();
  await expect(settings.getByText(/macOS uses the 🌐 key for Show Emoji & Symbols/)).toBeVisible();
  await settings.getByRole('button', { name: 'Open Keyboard settings' }).click();
  await settings.getByRole('switch', { name: 'Speak answers' }).click();
  await expect(settings.getByRole('switch', { name: 'Speak answers' })).toBeChecked();
  const ops = (await voiceCalls(page)).map((call) => call.op);
  expect(ops).toEqual(['turnOn', 'update', 'openSettings', 'update']);
});

test('Settings search finds the Voice rows under General', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await installFakeVoice(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const search = page.getByRole('combobox', { name: 'Search settings' });
  await search.fill('Speak answers');
  const option = page
    .getByRole('listbox', { name: 'Matching settings' })
    .getByRole('option', { name: /^Speak answers/ });
  await expect(option).toContainText('General · Voice');
  await search.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Voice' });
  await expect(dialog.getByRole('switch', { name: 'Speak answers' })).toBeFocused();
});

async function searchVoice(page: Page, label: string) {
  const search = page.getByRole('combobox', { name: 'Search settings' });
  await search.fill(label);
  const option = page
    .getByRole('listbox', { name: 'Matching settings' })
    .getByRole('option', { name: new RegExp(`^${label}`) });
  await expect(option).toContainText('General · Voice');
  await search.press('Enter');
  return page.getByRole('dialog', { name: 'Voice' });
}

for (const enabled of [false, true]) {
  test(`Settings search lands on a control for Shortcut and Hold to talk with Voice ${enabled ? 'on' : 'off'}`, async ({
    page,
  }) => {
    await resetTestDatabase({ onboarded: true });
    await installFakeVoice(page, { enabled });
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).click();
    const voiceSwitch = (dialog: ReturnType<Page['getByRole']>) =>
      dialog.getByRole('switch', { name: 'Voice', exact: true });

    const shortcut = await searchVoice(page, 'Shortcut');
    if (enabled) await expect(shortcut.getByRole('radio', { name: 'Use ⌥⇧V' })).toBeFocused();
    else await expect(voiceSwitch(shortcut)).toBeFocused();

    const hold = await searchVoice(page, 'Hold to talk');
    await expect(voiceSwitch(hold)).toBeFocused();
  });
}

test('a spoken new chat opens prefilled and starts nothing until "send"', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await installFakeVoice(page);
  await linkProject(page);
  await openIsland(page);
  const before = await userMessages();
  const listen = await press(page);
  expect(listen.purpose).toBe('command');
  await expect(island(page).getByText('Listening… Esc to cancel')).toBeVisible();
  await emitVoice(page, {
    kind: 'final',
    id: listen.id,
    text: 'Start a chat in feature web apps to add creator email.',
    reason: 'paused',
  });
  const box = island(page).getByRole('textbox', { name: 'Message' });
  await expect(box).toHaveValue('add creator email');
  await expect(island(page).getByRole('button', { name: 'feature-web-apps' })).toBeVisible();
  await page.waitForTimeout(400);
  expect(await userMessages()).toBe(before);
  const confirm = await say(page, 'send it');
  expect(confirm.purpose).toBe('confirm');
  await expect.poll(userMessages).toBe(before + 1);
});

async function openIslandWithProjects(page: Page) {
  const projectsLoaded = page.waitForResponse((response) =>
    response.url().endsWith('/api/projects'),
  );
  await openIsland(page);
  await projectsLoaded;
}

test('a project linked after the island loaded is matched by a spoken command', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await installFakeVoice(page);
  await openIslandWithProjects(page);
  await linkProject(page);
  const listen = await press(page);
  await emitVoice(page, {
    kind: 'final',
    id: listen.id,
    text: 'Start a chat in feature web apps to add creator email.',
    reason: 'paused',
  });
  await expect(island(page).getByRole('textbox', { name: 'Message' })).toHaveValue(
    'add creator email',
  );
  await expect(island(page).getByRole('button', { name: 'feature-web-apps' })).toBeVisible();
});

test('listening starts at once and a release before the project list loads still matches', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await installFakeVoice(page);
  await page.clock.install();
  await openIslandWithProjects(page);
  await linkProject(page);
  let answerProjects = () => {};
  const held = new Promise<void>((resolve) => {
    answerProjects = resolve;
  });
  await page.route('**/api/projects', async (route) => {
    await held;
    await route.continue();
  });
  await page.clock.pauseAt(Date.now() + 1_000);
  const listen = await press(page);
  await emitVoice(page, { kind: 'speech', id: listen.id });
  await emitVoice(page, {
    kind: 'final',
    id: listen.id,
    text: 'Start a chat in feature web apps to add creator email.',
    reason: 'stopped',
  });
  answerProjects();
  await expect(island(page).getByRole('textbox', { name: 'Message' })).toHaveValue(
    'add creator email',
  );
  await expect(island(page).getByRole('button', { name: 'feature-web-apps' })).toBeVisible();
  await page.unroute('**/api/projects');
});

test('a spoken ticket start keeps the autonomy level and project picked in the composer', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await resetTestDatabase({ onboarded: true });
  await resetTicketFakes();
  await installFakeVoice(page);
  await linkProject(page);
  await connectTickets(page, ['linear']);
  await openIsland(page);
  await say(page, 'Work on E N G one two one zero in feature web apps fix the copy');
  await expect(island(page).getByText('ENG-1210')).toBeVisible();
  await expect(island(page).getByRole('button', { name: 'feature-web-apps' })).toBeVisible();
  const level = island(page).getByRole('button', { name: /^Spark autonomy:/ });
  await expect(level).toHaveAccessibleName('Spark autonomy: Full auto → PR');
  await level.click();
  await expect(level).toHaveAccessibleName('Spark autonomy: Automatic');
  await island(page).getByRole('button', { name: 'Send', exact: true }).click();
  const db = openTestDb();
  try {
    await expect
      .poll(
        async () =>
          (
            await db.query(
              `SELECT c.overrides->c.provider->>'level' AS level, p.name AS project
                 FROM conversation_tickets t
                 JOIN conversations c ON c.id = t.conversation_id
                 LEFT JOIN conversation_projects cp ON cp.conversation_id = c.id
                 LEFT JOIN projects p ON p.id = cp.project_id
                WHERE t.ticket_key = 'ENG-1210'`,
            )
          ).rows[0],
        { timeout: 20_000 },
      )
      .toEqual({ level: 'hands-off', project: 'feature-web-apps' });
  } finally {
    await db.end();
  }
});

test('Esc while listening cancels with no transcript and no result', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await installFakeVoice(page);
  await openIsland(page);
  const listen = await press(page);
  await page.keyboard.press('Escape');
  await emitVoice(page, { kind: 'final', id: listen.id, text: 'who needs me', reason: 'paused' });
  await expect(island(page).getByText('Listening… Esc to cancel')).toHaveCount(0);
  await expect(island(page).getByText('“who needs me”')).toHaveCount(0);
  expect((await voiceCalls(page)).map((call) => call.op)).toContain('cancel');
});

test('Esc while the first listen is still starting cancels it once it resolves', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await installFakeVoice(page, { listenDelayMs: 600 });
  await openIsland(page);
  await emitVoice(page, { kind: 'press' });
  await expect(island(page).getByText('Listening… Esc to cancel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(island(page).getByText('Listening… Esc to cancel')).toHaveCount(0);
  await expect
    .poll(async () => (await voiceCalls(page)).filter((call) => call.op !== 'hush'))
    .toEqual([
      { op: 'listen', args: ['command', expect.any(String)] },
      { op: 'resolved', args: ['listen-1'] },
      { op: 'cancel', args: ['listen-1'] },
    ]);
  await emitVoice(page, { kind: 'press' });
  await expect(island(page).getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  const listens = (await voiceCalls(page)).filter((call) => call.op === 'listen');
  expect(listens).toHaveLength(2);
});

test('an instant answer arms no confirmation: "yes" afterwards sends no draft', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await installFakeVoice(page);
  await openIsland(page);
  await say(page, 'What did I spend today?');
  const ask = island(page).getByRole('textbox', { name: 'Ask Spark' });
  await ask.fill('Delete every branch I have');
  const before = await userMessages();
  await say(page, 'Who needs me?');
  await expect(island(page).getByText('Nothing needs you right now.')).toBeVisible();
  const next = await say(page, 'yes');
  expect(next.purpose).toBe('command');
  await page.waitForTimeout(400);
  expect(await userMessages()).toBe(before);
});

test('open shows a result card with the best match preselected, and Enter opens it', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  const [dashboards] = await seedChats([
    { title: 'Dashboards' },
    { title: 'Dashboard filters' },
    { title: 'Release notes' },
  ]);
  await installFakeVoice(page, { speakAnswers: true });
  await openIsland(page);
  await say(page, 'Open the Dashboards chat.');
  const list = island(page).getByRole('listbox', { name: 'Matches' });
  await expect(list.getByRole('option', { name: /^Dashboards/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(list.getByRole('option', { name: /^Dashboards/ })).toBeFocused();
  await expect
    .poll(async () => (await voiceCalls(page)).find((call) => call.op === 'speak')?.args[0])
    .toBe('Found Dashboards. Open it?');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { openedChats: string[] }).openedChats))
    .toEqual([dashboards]);
});

test('who needs me answers at once in Ask Spark, read-only, and speaks it', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([
    {
      title: 'Speed up the test suite',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'npm test', command: 'npm test' },
    },
  ]);
  await installFakeVoice(page, { speakAnswers: true });
  await openIsland(page);
  const before = await userMessages();
  await say(page, 'Who needs me?');
  await expect(island(page).getByText(/1 chat needs you: “Speed up the test suite”/)).toBeVisible();
  await expect
    .poll(async () => (await voiceCalls(page)).find((call) => call.op === 'speak')?.args[0])
    .toMatch(/1 chat needs you/);
  expect(await userMessages()).toBe(before);
});

test('any other question waits in the Ask Spark box for Enter', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await installFakeVoice(page);
  await openIsland(page);
  const before = await userMessages();
  await say(page, 'Why did the billing build fail yesterday?');
  const ask = island(page).getByRole('textbox', { name: 'Ask Spark' });
  await expect(ask).toHaveValue('Why did the billing build fail yesterday');
  await page.waitForTimeout(400);
  expect(await userMessages()).toBe(before);
});

test('approvals cannot be spoken: "yes" with a card waiting answers nothing', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([
    {
      title: 'Deploy check',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'npm run deploy', command: 'npm run deploy' },
    },
  ]);
  await installFakeVoice(page);
  await openIsland(page);
  await say(page, 'yes');
  await expect(island(page).getByRole('textbox', { name: 'Ask Spark' })).toHaveValue('yes');
  const db = openTestDb();
  try {
    const result = await db.query(`SELECT status FROM approvals`);
    expect(result.rows.map((row) => row.status)).toEqual(['pending']);
  } finally {
    await db.end();
  }
});

test('a denied microphone says so and opens Microphone settings', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await installFakeVoice(page, { listenError: 'mic_denied' });
  await openIsland(page);
  await emitVoice(page, { kind: 'press' });
  await expect(island(page).getByText('Spark can’t use the microphone.')).toBeVisible();
  await island(page).getByRole('button', { name: 'Open Microphone settings' }).click();
  expect((await voiceCalls(page)).at(-1)).toEqual({ op: 'openSettings', args: ['microphone'] });
});

test('dictation fills the chat composer and is never sent', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  const [chat] = await seedChats([{ title: 'Write the release notes' }]);
  await installFakeVoice(page);
  await page.goto(`/?chat=${chat}`);
  const before = await userMessages();
  const mic = page.getByRole('button', { name: 'Dictate' });
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  await mic.click();
  await expect(page.getByRole('button', { name: 'Stop dictating' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const id = 'listen-1';
  await emitVoice(page, { kind: 'partial', id, text: 'please check the login' });
  await expect(page.getByText('please check the login')).toBeVisible();
  await page.getByRole('button', { name: 'Stop dictating' }).click();
  await emitVoice(page, {
    kind: 'final',
    id,
    text: 'please check the login redirect. then add a test.',
    reason: 'stopped',
  });
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(
    'please check the login redirect. then add a test.',
  );
  await page.waitForTimeout(400);
  expect(await userMessages()).toBe(before);
  const ops = (await voiceCalls(page)).map((call) => call.op);
  expect(ops.filter((op) => op !== 'resolved')).toEqual(['listen', 'stop']);
});
