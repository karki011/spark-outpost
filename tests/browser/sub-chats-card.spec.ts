import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  SPARK_ACTION_OPTION,
  subChatActionLabels,
  subChatActionQuestion,
  type PlannedSubChat,
  type StartSubChatsAction,
} from '../../packages/contracts/src/index.ts';
import { openChats } from './navigation.ts';
import { resetWithAgents } from './project-chat-kit.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOT = process.env.SUB_CHATS_CARD_SHOT ?? '';
const PROJECT = 'storefront';
const PARENT = 'Checkout rewrite';
const SKINS = { light: 'apricot', dark: 'graphite' } as const;

let base = '';
let parentId = '';
let pieces: PlannedSubChat[] = [];

test.beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-sub-chats-card-')));
});

test.afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

function planned(project: PlannedSubChat['project']): PlannedSubChat[] {
  const piece = (title: string, task: string, extra: Partial<PlannedSubChat>): PlannedSubChat => ({
    conversationId: randomUUID(),
    title,
    task,
    project,
    provider: 'claude',
    agentName: 'Claude',
    model: 'opus[1m]',
    effort: 'high',
    agentMode: 'default',
    level: 'full-auto',
    sameAsParent: true,
    stackedOn: null,
    startsAfter: [],
    ...extra,
  });
  const api = piece('Payments API v2', 'Build the payments/v2 client behind a flag.', {});
  const totals = piece('Cart totals service', 'Move cart totals behind totals/.', {
    model: 'sonnet',
    effort: 'medium',
    sameAsParent: false,
  });
  const ui = piece('Checkout UI', 'Rebuild the checkout form on the v2 client.', {
    stackedOn: api.conversationId,
  });
  const tests = piece('E2E checkout tests', 'Cover the whole checkout end to end.', {
    startsAfter: [api.conversationId, totals.conversationId, ui.conversationId],
  });
  return [api, totals, ui, tests];
}

test.beforeEach(async ({ page }) => {
  test.slow();
  await resetWithAgents();
  await page.setViewportSize({ width: 1400, height: 950 });
  await openChats(page);
  const folder = path.join(mkdtempSync(path.join(base, 'p-')), PROJECT);
  mkdirSync(folder);
  const created = await page.request.post('/api/projects', { data: { rootPath: folder } });
  expect(created.ok()).toBe(true);
  const { id: projectId } = (await created.json()) as { id: string };
  parentId = randomUUID();
  pieces = planned({ id: projectId, name: PROJECT });
  const action: StartSubChatsAction = {
    action: 'start_sub_chats',
    parent: { id: parentId, title: PARENT },
    pieces,
  };
  await seedChats([
    {
      id: parentId,
      title: PARENT,
      projectIds: [projectId],
      run: { status: 'awaiting_approval', provider: 'claude', agentMode: 'default' },
      approval: {
        kind: 'spark_action',
        title: subChatActionQuestion(action),
        payload: {
          sparkAction: action,
          sparkResult: { state: 'waiting', message: null, url: null },
          sparkRequested: true,
        },
        options: [
          {
            optionId: SPARK_ACTION_OPTION.confirm,
            name: subChatActionLabels.start_sub_chats.confirm,
            kind: 'allow_once',
          },
          { optionId: SPARK_ACTION_OPTION.decline, name: 'Discard', kind: 'reject_once' },
        ],
      },
    },
  ]);
  await openChats(page);
  await page
    .getByRole('navigation', { name: 'Chats' })
    .locator('.row-open')
    .and(page.getByRole('button', { name: new RegExp(`^${PARENT}`) }))
    .click();
  await expect(card(page)).toBeVisible();
});

const card = (page: Page) =>
  page.getByRole('main').getByRole('group', { name: /^Start 4 sub-chats\?/ });
const rows = (page: Page) =>
  card(page).getByRole('list', { name: 'Sub-chats to start' }).locator('> li');

function decision(page: Page) {
  return page.waitForRequest(
    (request) => request.url().endsWith('/decision') && request.method() === 'POST',
  );
}

async function pick(page: Page, picker: string, choice: RegExp) {
  await card(page).getByRole('button', { name: picker }).click();
  await page
    .getByRole('menu', { name: picker })
    .getByRole('menuitemradio', { name: choice })
    .click();
}

test('the plan card lists each piece and Edit changes a piece’s model and effort before Start', async ({
  page,
}) => {
  await expect(rows(page).locator('b')).toHaveText(pieces.map((piece) => piece.title));
  await expect(rows(page).nth(0)).toContainText('storefront · New branch');
  await expect(rows(page).nth(0)).toContainText('Same as this chat');
  await expect(rows(page).nth(1)).toContainText('Claude · Sonnet 5 · medium effort');
  await expect(rows(page).nth(2)).toContainText('Stacked on 1');
  await expect(rows(page).nth(3)).toContainText('Starts after 1, 2, 3');
  await expect(card(page).getByRole('button')).toHaveText([
    'Show each task ›',
    'Start',
    'Edit',
    'Discard',
  ]);

  await expect(card(page).getByText('Move cart totals behind totals/.')).toHaveCount(0);
  await card(page).getByRole('button', { name: 'Show each task ›' }).click();
  await expect(card(page).getByText('Move cart totals behind totals/.')).toBeVisible();

  const edit = card(page).getByRole('button', { name: 'Edit' });
  const fill = () => edit.evaluate((button) => getComputedStyle(button).backgroundColor);
  const discard = card(page).getByRole('button', { name: 'Discard' });
  await expect(edit).toHaveAttribute('aria-pressed', 'false');
  const resting = await fill();
  await edit.focus();
  await page.keyboard.press('Enter');
  await expect(edit).toHaveAttribute('aria-pressed', 'true');
  await discard.hover();
  await expect.poll(fill).not.toBe(resting);
  await expect
    .poll(() => edit.evaluate((button) => getComputedStyle(button).boxShadow))
    .not.toBe('none');
  await expect(
    card(page).getByRole('group', { name: 'Model and effort for E2E checkout tests' }),
  ).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(card(page).getByRole('button', { name: 'Start', exact: true })).toBeFocused();

  await pick(page, 'Model for E2E checkout tests', /^Sonnet 5/);
  await pick(page, 'Effort for E2E checkout tests', /^low/);
  await expect(card(page).getByRole('button', { name: 'Model for E2E checkout tests' })).toHaveText(
    'Sonnet 5',
  );
  for (const [theme, skin] of Object.entries(SKINS)) {
    await page.evaluate((value) => {
      document.documentElement.dataset.skin = value;
    }, skin);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const results = await new AxeBuilder({ page })
      .include('.appr.sac')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    if (SHOT && theme === 'dark') await page.screenshot({ path: SHOT });
  }

  await edit.click();
  await expect(rows(page).nth(3)).toContainText('Claude · Sonnet 5 · low effort');
  const sent = decision(page);
  await card(page).getByRole('button', { name: 'Start', exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    optionId: SPARK_ACTION_OPTION.confirm,
    edits: { subChats: [{ id: pieces[3]!.conversationId, model: 'sonnet', effort: 'low' }] },
  });
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/conversations/${parentId}/sub-chats`);
      const body = (await response.json()) as {
        subChats: { title: string; startedWith: { model: string | null; effort: string | null } }[];
      };
      return body.subChats.find((row) => row.title === 'E2E checkout tests')?.startedWith;
    })
    .toMatchObject({ model: 'sonnet', effort: 'low' });
});

test('Discard sends no edits and starts nothing', async ({ page }) => {
  await card(page).getByRole('button', { name: 'Edit' }).click();
  await pick(page, 'Model for Payments API v2', /^Sonnet 5/);
  const sent = decision(page);
  await card(page).getByRole('button', { name: 'Discard' }).click();
  const body = (await sent).postDataJSON() as Record<string, unknown>;
  expect(body.optionId).toBe(SPARK_ACTION_OPTION.decline);
  expect(body.edits).toBeUndefined();
  await expect(card(page).getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
  const response = await page.request.get(`/api/conversations/${parentId}/sub-chats`);
  expect(((await response.json()) as { subChats: unknown[] }).subChats).toEqual([]);
});
