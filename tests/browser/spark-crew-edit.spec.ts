import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { seedConversation, seedTurn } from '../../apps/server/test/outcome-seed.ts';
import { addSpark, openSparksPage } from './crew-files-kit.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { animationsSettled } from './settle.ts';

const SKILL =
  '---\nname: notes\ndescription: Write release notes from merged pull requests\n---\nList merged pull requests.\n';
const SCRIPT = `${Array.from({ length: 340 }, (_, index) => `echo step ${index + 1}`).join('\n')}\n`;

interface FileChange {
  path: string;
  change: 'new' | 'changed' | 'deleted';
  before: string | null;
  after: string | null;
  baseHash: string | null;
}

interface CrewFile {
  text: string;
  hash: string;
}

async function saveFile(page: Page, sparkId: string, path: string, text: string) {
  const response = await page.request.put(`/api/teammates/${sparkId}/files`, {
    data: { path, text, baseHash: null },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as CrewFile;
}

async function fileOf(page: Page, sparkId: string, path: string): Promise<CrewFile> {
  const response = await page.request.get(`/api/teammates/${sparkId}/files`, { params: { path } });
  expect(response.status()).toBe(200);
  return (await response.json()) as CrewFile;
}

async function filePaths(page: Page, sparkId: string): Promise<string[]> {
  const folder = (await (await page.request.get(`/api/teammates/${sparkId}/folder`)).json()) as {
    files: { path: string }[];
  };
  return folder.files.map((file) => file.path);
}

interface CrewTarget {
  target: 'spark' | 'workflow';
  id: string;
  name: string;
}

async function crewCardChat(
  sparkId: string,
  files: FileChange[],
  similar: object[] = [],
  about: CrewTarget = { target: 'spark', id: sparkId, name: 'Scout' },
) {
  const action = {
    action: 'crew_edit',
    ...about,
    files,
    similar,
    agent: 'Claude',
    modeName: 'Bypass permissions',
  };
  const payload = {
    command: null,
    cwd: null,
    paths: [],
    diffs: [],
    truncated: false,
    sparkAction: action,
    sparkResult: { state: 'waiting', message: null, url: null },
  };
  const options = [
    { optionId: 'confirm', name: 'Allow', kind: 'allow_once' },
    { optionId: 'decline', name: 'Deny', kind: 'reject_once' },
  ];
  const db = openTestDb();
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    const conversationId = await seedConversation(db, workspaceId);
    const runId = await seedTurn(db, conversationId, {
      request: 'Give Scout a release notes skill',
      status: 'awaiting_approval',
    });
    await db.query(
      `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options,
         status)
       VALUES ($1, $2, $3, 'spark_action', $6, $4, 'hash', $5, 'pending')`,
      [
        randomUUID(),
        runId,
        `spark:crew_edit:${randomUUID()}`,
        payload,
        JSON.stringify(options),
        `Change the ${about.name} ${about.target === 'spark' ? 'Spark' : 'workflow'}?`,
      ],
    );
  } finally {
    await db.end();
  }
}

async function openCard(page: Page) {
  await openChats(page);
  await page
    .getByRole('navigation', { name: 'Chats' })
    .getByRole('button', { name: 'Outcomes', exact: true })
    .click();
  await page.getByRole('button', { name: 'Details for Scout' }).click();
  const card = page
    .getByRole('dialog', { name: 'Scout' })
    .getByRole('group', { name: /Change the Scout Spark\?/ });
  await expect(card).toBeVisible();
  return card;
}

let sparkId: string;

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
  await page.setViewportSize({ width: 1400, height: 900 });
  sparkId = await addSpark(page, {
    name: 'Scout',
    role: 'Code reviewer',
    instructions: 'Be brief.\nName the file.\n',
  });
});

test('the card shows new files in full and changed lines, and Allow writes them', async ({
  page,
}) => {
  const current = await fileOf(page, sparkId, 'SPARK.md');
  await crewCardChat(
    sparkId,
    [
      { path: 'skills/notes/SKILL.md', change: 'new', before: null, after: SKILL, baseHash: null },
      { path: 'skills/notes/run.sh', change: 'new', before: null, after: SCRIPT, baseHash: null },
      {
        path: 'SPARK.md',
        change: 'changed',
        before: current.text,
        after: 'Be thorough.\nName the file.\n',
        baseHash: current.hash,
      },
    ],
    [{ kind: 'skill', name: 'release-notes', spark: 'Scribe', reason: 'similar_name' }],
  );
  const card = await openCard(page);
  await expect(card).toContainText('Claude · Bypass permissions wants to change 3 files');
  await expect(card.getByRole('note')).toHaveText(
    'You already have the release-notes skill of Scribe (similar name).',
  );
  const tree = card.getByRole('tree', { name: 'Files in this change' });
  await expect(tree.locator('[data-badge]')).toHaveText(['Changed', 'New', 'New']);
  await expect(card.getByText('1 of 3 files read')).toBeVisible();
  const instructions = card.getByRole('region', { name: 'Changes to SPARK.md' });
  await expect(instructions.locator('.dv-row.remove')).toContainText('Be brief.');
  await expect(instructions.locator('.dv-row.add')).toContainText('Be thorough.');
  await page.screenshot({ path: 'test-results/spark-crew-edit/review-window.png' });
  await tree.getByRole('treeitem', { name: /^SKILL\.md/ }).click();
  const skill = card.getByRole('region', { name: 'New: skills/notes/SKILL.md' });
  await expect(skill.getByRole('radio', { name: 'Formatted' })).toBeChecked();
  await page.screenshot({ path: 'test-results/spark-crew-edit/review-window-skill.png' });
  await tree.getByRole('treeitem', { name: /^run\.sh/ }).press('Enter');
  const script = card.getByRole('region', { name: 'Changes to skills/notes/run.sh' });
  await expect(script.locator('.dv-row.add')).toHaveCount(340);
  await expect(script).toContainText('echo step 340');
  await expect(script.getByRole('button', { name: /more lines/ })).toHaveCount(0);
  await expect(card.getByText('3 of 3 files read')).toBeVisible();
  await expect(card).toContainText('Read the new text before you allow it.');

  await card.getByRole('button', { name: 'Allow' }).click();
  await expect
    .poll(() => filePaths(page, sparkId), { timeout: 15_000 })
    .toEqual(['SPARK.md', 'skills/notes/SKILL.md', 'skills/notes/run.sh']);
  expect((await fileOf(page, sparkId, 'SPARK.md')).text).toBe('Be thorough.\nName the file.\n');
  await expect(page.getByText('Changed the Scout Spark’s files: 2 new, 1 changed.')).toBeVisible();
});

test('a delete is confirmed only by its button, and Deny leaves the files', async ({ page }) => {
  const saved = await saveFile(page, sparkId, 'skills/notes/SKILL.md', SKILL);
  await crewCardChat(sparkId, [
    {
      path: 'skills/notes/SKILL.md',
      change: 'deleted',
      before: SKILL,
      after: null,
      baseHash: saved.hash,
    },
  ]);
  const card = await openCard(page);
  await expect(card.getByRole('tree').locator('[data-badge]')).toHaveText(['Deleted']);
  const removed = card.getByRole('region', { name: 'Changes to skills/notes/SKILL.md' });
  await expect(removed.locator('.dv-row.remove').first()).toBeVisible();
  await expect(removed.locator('.dv-row.add')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Allow' })).not.toBeFocused();
  await removed.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('y');
  await expect(card.getByRole('button', { name: 'Deny' })).toBeVisible();
  expect(await filePaths(page, sparkId)).toContain('skills/notes/SKILL.md');
  await card.getByRole('button', { name: 'Deny' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('group', { name: /Change the Scout Spark\?/ })).toContainText(
    'Chose: Deny.',
  );
  expect(await filePaths(page, sparkId)).toEqual(['SPARK.md', 'skills/notes/SKILL.md']);
});

test('a file changed after the card was shown is not overwritten', async ({ page }) => {
  const current = await fileOf(page, sparkId, 'SPARK.md');
  await crewCardChat(sparkId, [
    {
      path: 'SPARK.md',
      change: 'changed',
      before: current.text,
      after: 'Be thorough.\n',
      baseHash: current.hash,
    },
  ]);
  const edited = await page.request.put(`/api/teammates/${sparkId}/files`, {
    data: { path: 'SPARK.md', text: 'Edited by hand.\n', baseHash: current.hash },
  });
  expect(edited.status()).toBe(200);
  const card = await openCard(page);
  await card.getByRole('button', { name: 'Allow' }).click();
  await expect(page.getByText(/Changed since the card was shown: SPARK\.md/)).toBeVisible({
    timeout: 15_000,
  });
  expect((await fileOf(page, sparkId, 'SPARK.md')).text).toBe('Edited by hand.\n');
});

test('a paired device sees the card waiting and cannot answer it', async ({ page }) => {
  await crewCardChat(sparkId, [
    { path: 'skills/notes/SKILL.md', change: 'new', before: null, after: SKILL, baseHash: null },
  ]);
  await page.route('**/api/remote/session', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: {
        ...((await response.json()) as object),
        remote: true,
        device: { id: '00000000-0000-4000-8000-000000000001', name: 'Maya’s iPhone' },
        address: 'https://mac.tail.test',
      },
    });
  });
  const card = await openCard(page);
  await expect(card).toContainText(
    'Answer on your Mac. Sparks and workflows cards are answered on your Mac.',
  );
  await expect(card.getByRole('region', { name: 'New: skills/notes/SKILL.md' })).toContainText(
    'List merged pull requests.',
  );
  await expect(card.getByRole('button', { name: 'Allow' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Deny' })).toHaveCount(0);
  expect(await filePaths(page, sparkId)).toEqual(['SPARK.md']);
});

test('a paired device answers the card once Sparks and workflows cards can go there', async ({
  page,
}) => {
  await crewCardChat(sparkId, [
    { path: 'skills/notes/SKILL.md', change: 'new', before: null, after: SKILL, baseHash: null },
  ]);
  await page.route('**/api/remote/session', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: {
        ...((await response.json()) as object),
        remote: true,
        device: { id: '00000000-0000-4000-8000-000000000001', name: 'Maya’s iPhone' },
        address: 'https://mac.tail.test',
        cardAnswering: { from: 'devices', macOnly: [] },
      },
    });
  });
  const card = await openCard(page);
  await expect(card).not.toContainText('Answer on your Mac.');
  await expect(card.getByRole('region', { name: 'New: skills/notes/SKILL.md' })).toContainText(
    'List merged pull requests.',
  );
  await card.getByRole('button', { name: 'Deny' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('group', { name: /Change the Scout Spark\?/ })).toContainText(
    'Chose: Deny.',
  );
  expect(await filePaths(page, sparkId)).toEqual(['SPARK.md']);
});

test('Esc closes the details window without answering, and focus goes back to Details', async ({
  page,
}) => {
  await crewCardChat(sparkId, [
    { path: 'skills/notes/SKILL.md', change: 'new', before: null, after: SKILL, baseHash: null },
  ]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const card = await openCard(page);
  await expect(card.getByRole('button', { name: 'Allow' })).not.toBeFocused();
  await animationsSettled(page);
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.crw-modal')
    .analyze();
  expect(scan.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Scout' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: /Change the Scout Spark\?/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Details for Scout' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  expect(await filePaths(page, sparkId)).toEqual(['SPARK.md']);
});

test('Review on a waiting workflow draft opens its chat with the details window', async ({
  page,
}) => {
  const workflow = '{\n  "id": "nightly",\n  "steps": []\n}\n';
  await crewCardChat(
    sparkId,
    [{ path: 'nightly.json', change: 'new', before: null, after: workflow, baseHash: null }],
    [],
    { target: 'workflow', id: 'nightly', name: 'Nightly' },
  );
  await openSparksPage(page);
  const draft = page
    .getByRole('listitem')
    .filter({ hasText: 'Workflow · Draft · waiting for you' });
  await draft.getByRole('button', { name: 'Review Nightly' }).click();
  const window = page.getByRole('dialog', { name: 'Nightly' });
  await expect(window.getByRole('group', { name: /Add the Nightly workflow\?/ })).toBeVisible();
  await expect(window.getByRole('region', { name: 'Changes to nightly.json' })).toBeVisible();
});

test('the card is one line answered in place', async ({ page }) => {
  await crewCardChat(sparkId, [
    { path: 'skills/notes/SKILL.md', change: 'new', before: null, after: SKILL, baseHash: null },
  ]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openChats(page);
  await page
    .getByRole('navigation', { name: 'Chats' })
    .getByRole('button', { name: 'Outcomes', exact: true })
    .click();
  const line = page.getByRole('group', { name: /Change the Scout Spark\?/ });
  await expect(line).toContainText('skills/notes/SKILL.md (new)');
  await expect(line.getByRole('button')).toHaveText(['Details', 'Deny', 'Allow']);
  await animationsSettled(page);
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .include('.crw-ready')
    .analyze();
  expect(scan.violations).toEqual([]);
  await line.screenshot({ path: 'test-results/spark-crew-edit/one-line-card.png' });
  await line.getByRole('button', { name: 'Allow' }).click();
  await expect.poll(() => filePaths(page, sparkId)).toEqual(['SPARK.md', 'skills/notes/SKILL.md']);
});
