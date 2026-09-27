import { basename, join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import type { Approval, InvolvementLevel } from '../../packages/contracts/src/index.ts';
import type { Db } from '../../apps/server/src/persistence/db.ts';
import {
  shouldCancel,
  sleep,
  type Api,
  type Chat,
  type TurnOptions,
  type TurnOutcome,
  type UiNote,
} from './api-driver.ts';
import { balancedChoice } from './balanced.ts';
import type { HarnessSetup, ModelChoice } from './plan.ts';

const CARD_VISIBLE_MS = 15_000;

const LEVEL_LABELS: Record<InvolvementLevel, string> = {
  'hands-on': 'Hands-on',
  balanced: 'Balanced',
  'hands-off': 'Hands-off',
  'full-auto': 'Full auto',
};

const MODEL_LABELS: Record<ModelChoice, RegExp> = {
  auto: /^Auto/,
  haiku: /^Haiku 4\.5/,
  sonnet: /^Sonnet 5/,
  'opus[1m]': /^Opus 5\.5/,
};

export interface UiSession {
  page: Page;
  api: Api;
  web: string;
  shots: string;
  prefix: string;
  shotCount: number;
  consoleErrors: string[];
}

export async function openBrowser(): Promise<Browser> {
  return chromium.launch({ headless: process.env.E2E_HEADED !== '1' });
}

export async function newUiSession(
  browser: Browser,
  api: Api,
  web: string,
  shots: string,
  prefix: string,
): Promise<UiSession> {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const session: UiSession = { page, api, web, shots, prefix, shotCount: 0, consoleErrors: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') session.consoleErrors.push(message.text().slice(0, 300));
  });
  page.on('pageerror', (error) => session.consoleErrors.push(`pageerror: ${error.message}`));
  return session;
}

export async function shoot(session: UiSession, label: string): Promise<string> {
  session.shotCount += 1;
  const name = `${session.prefix}-${String(session.shotCount).padStart(2, '0')}-${label}.png`;
  const path = join(session.shots, name.replace(/[^\w.-]+/g, '-'));
  await session.page.screenshot({ path, fullPage: false }).catch(() => undefined);
  return path;
}

function note(notes: UiNote[], kind: UiNote['kind'], text: string, shot?: string) {
  notes.push({ at: new Date().toISOString(), kind, text, ...(shot ? { shot } : {}) });
}

async function linkRepoInMenu(session: UiSession, repo: string, notes: UiNote[]) {
  const { page } = session;
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  const option = menu.getByRole('button', { name: new RegExp(`^${basename(repo)}`) });
  const listed = await option
    .waitFor({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!listed) {
    const shot = await shoot(session, 'repo-not-in-recent');
    note(
      notes,
      'bug',
      `The just-added folder ${basename(repo)} is not in the menu's Recent list.`,
      shot,
    );
    throw new Error('The project is not offered in the project menu.');
  }
  await option.click();
  await menu
    .getByRole('list', { name: 'Linked repos' })
    .getByText(basename(repo), { exact: true })
    .waitFor();
  return menu;
}

export async function openUiChat(
  session: UiSession,
  repo: string,
  setup: HarnessSetup,
  checks: readonly string[] | undefined,
  notes: UiNote[],
): Promise<Chat> {
  const { page } = session;
  const projectId = await session.api.linkProject(repo, 'off', checks);
  await page.goto(session.web);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const menu = await linkRepoInMenu(session, repo, notes);
  if (setup.buildStyle !== 'off') {
    const styles = menu.getByRole('radiogroup', { name: `Build style for ${basename(repo)}` });
    const label = setup.buildStyle === 'lean' ? 'Lean' : 'Lite';
    await styles.getByRole('radio', { name: label }).click();
    await styles.getByRole('radio', { name: label, checked: true }).waitFor();
  }
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  const panel = page.getByRole('dialog', { name: 'Model, effort, and permissions' });
  await panel.getByRole('radio', { name: MODEL_LABELS[setup.model] }).first().click();
  await panel.getByRole('tab', { name: /Permissions/ }).click();
  await panel.getByRole('radio', { name: /^Do/ }).click();
  const level = LEVEL_LABELS[setup.level];
  await panel
    .getByRole('radiogroup', { name: 'Involvement level' })
    .getByRole('radio', { name: new RegExp(`^${level}`) })
    .click();
  await panel
    .getByRole('tab', { name: /Permissions/ })
    .filter({ hasText: `Do · ${level}` })
    .waitFor();
  await page.keyboard.press('Escape');
  await shoot(session, 'chat-ready');
  return { conversationId: '', projectId, repo };
}

async function sendText(page: Page, text: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
}

async function conversationFor(db: Db, repo: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT c.id FROM conversations c
     JOIN conversation_projects cp ON cp.conversation_id = c.id
     JOIN projects p ON p.id = cp.project_id
     WHERE p.root_path = $1 ORDER BY c.created_at DESC LIMIT 1`,
    [repo],
  );
  return rows[0]?.id ?? '';
}

async function topRuns(db: Db, conversationId: string): Promise<string[]> {
  if (!conversationId) return [];
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM runs WHERE conversation_id = $1 AND parent_run_id IS NULL ORDER BY created_at`,
    [conversationId],
  );
  return rows.map((row) => row.id);
}

async function waitForRun(db: Db, chat: Chat, before: string[]): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (!chat.conversationId) chat.conversationId = await conversationFor(db, chat.repo);
    const fresh = (await topRuns(db, chat.conversationId)).filter((id) => !before.includes(id));
    if (fresh[0]) return fresh[0];
    await sleep(300);
  }
  throw new Error('The message did not start a run within 30 s.');
}

async function reviewFromWorkPanel(session: UiSession): Promise<void> {
  const work = session.page.getByRole('complementary', { name: 'Work panel' });
  const review = work
    .getByRole('list', { name: 'Waiting for you' })
    .getByRole('button', { name: 'Review' })
    .first();
  if ((await review.count()) > 0) await review.click({ timeout: 2_000 }).catch(() => undefined);
}

async function viaApi(session: UiSession, approval: Approval, outcome: TurnOutcome) {
  const choice = balancedChoice(approval);
  if (!choice.waitForAuto) await session.api.decide(approval, choice);
  outcome.answered.push({ kind: approval.kind, label: choice.label, via: 'api', why: choice.why });
}

async function answerInUi(
  session: UiSession,
  approval: Approval,
  outcome: TurnOutcome,
  seen: Map<string, number>,
): Promise<void> {
  if (seen.get(`done:${approval.id}`)) return;
  const choice = balancedChoice(approval);
  const card = session.page.locator(`[id="approval-${approval.id}"]`);
  const firstSeen = seen.get(approval.id) ?? Date.now();
  seen.set(approval.id, firstSeen);
  if (!(await card.isVisible().catch(() => false))) {
    await card.scrollIntoViewIfNeeded({ timeout: 1_000 }).catch(() => undefined);
    if (Date.now() - firstSeen > 3_000 && !seen.has(`review:${approval.id}`)) {
      seen.set(`review:${approval.id}`, 1);
      await reviewFromWorkPanel(session);
    }
    if (Date.now() - firstSeen < CARD_VISIBLE_MS) return;
    const inDom = (await card.count()) > 0;
    const shot = await shoot(session, `missing-${approval.kind}`);
    note(
      outcome.notes,
      'bug',
      `No card on screen for a pending ${approval.kind} approval (“${approval.title.slice(0, 80)}”) after 15 s, even after Review in the work panel${inDom ? '; the card is in the page but hidden' : '; the card is not in the page'}.`,
      shot,
    );
    seen.set(`done:${approval.id}`, 1);
    return viaApi(session, approval, outcome);
  }
  if (!seen.has(`shot:${approval.id}`)) {
    seen.set(`shot:${approval.id}`, 1);
    await card.scrollIntoViewIfNeeded().catch(() => undefined);
    await shoot(session, approval.kind);
  }
  if (choice.waitForAuto) {
    const counting = await card.getByRole('button', { name: /\(\d+s\)$/ }).count();
    if (counting === 0 && Date.now() - firstSeen > 3_000 && !seen.has(`count:${approval.id}`)) {
      seen.set(`count:${approval.id}`, 1);
      note(
        outcome.notes,
        'ux',
        `A ${approval.kind} card will continue on its own but shows no countdown.`,
      );
    }
    return;
  }
  const button = card.getByRole('button', { name: choice.label, exact: true });
  seen.set(`done:${approval.id}`, 1);
  if ((await button.count()) === 0) {
    const shot = await shoot(session, `no-button-${approval.kind}`);
    note(outcome.notes, 'bug', `The ${approval.kind} card has no “${choice.label}” button.`, shot);
    return viaApi(session, approval, outcome);
  }
  await button.first().click();
  outcome.answered.push({ kind: approval.kind, label: choice.label, via: 'ui', why: choice.why });
}

async function settleUi(session: UiSession, outcome: TurnOutcome): Promise<void> {
  const { page } = session;
  const ready = await page
    .getByRole('button', { name: 'Send' })
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!ready)
    note(
      outcome.notes,
      'bug',
      'The run finished but the composer did not return to Send within 20 s.',
    );
  const foot = page.locator('.crew-turn .crew-foot').last();
  if ((await foot.count()) > 0) {
    const text = (await foot.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    note(outcome.notes, 'info', `Crew footer: ${text.slice(0, 200)}`);
  }
  const states = await page
    .locator('.crew-turn .agent-state')
    .allInnerTexts()
    .catch(() => []);
  const working = states.filter((text) => /Working|Thinking|Waiting/.test(text));
  if (working.length > 0) {
    const shot = await shoot(session, 'stale-state');
    note(
      outcome.notes,
      'bug',
      `Agents still shown as ${working.join(', ')} after the run finished.`,
      shot,
    );
  }
}

async function stopInUi(session: UiSession, outcome: TurnOutcome, started: number) {
  outcome.cancelledAtMs = Date.now() - started;
  await shoot(session, 'before-stop');
  const stop = session.page.getByRole('button', { name: 'Stop' }).last();
  const clicked = await stop
    .click({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!clicked) {
    note(outcome.notes, 'bug', 'No Stop button to click while the crew was working.');
    await session.api.cancel(outcome.runId);
  }
}

export async function sendUiTurn(
  session: UiSession,
  db: Db,
  chat: Chat,
  text: string,
  options: TurnOptions,
): Promise<TurnOutcome> {
  const before = await topRuns(db, chat.conversationId);
  const started = Date.now();
  await sendText(session.page, text);
  const runId = await waitForRun(db, chat, before);
  const outcome: TurnOutcome = {
    runId,
    wallMs: 0,
    timedOut: false,
    cancelledAtMs: null,
    answered: [],
    notes: [],
  };
  const seen = new Map<string, number>();
  while (!(await session.api.finished(runId))) {
    for (const approval of await session.api.pending(chat.conversationId)) {
      await answerInUi(session, approval, outcome, seen);
    }
    if (await shouldCancel(outcome, options)) await stopInUi(session, outcome, started);
    if (!outcome.timedOut && Date.now() - started > options.timeoutMs) {
      outcome.timedOut = true;
      await shoot(session, 'timeout');
      await session.api.cancel(runId);
    }
    await sleep(500);
  }
  outcome.wallMs = Date.now() - started;
  await settleUi(session, outcome);
  await shoot(session, 'done');
  return outcome;
}

export async function startFreshInUi(session: UiSession, notes: UiNote[]): Promise<void> {
  const { page } = session;
  await page.getByRole('button', { name: 'Chat actions' }).click();
  const response = page.waitForResponse((candidate) => candidate.url().endsWith('/fresh-session'));
  await page.getByRole('menuitem', { name: 'Start fresh' }).click();
  const status = (await response).status();
  if (status !== 200) note(notes, 'bug', `Start fresh answered ${status}.`);
}
