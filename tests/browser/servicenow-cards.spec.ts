import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  SPARK_ACTION_OPTION,
  serviceNowAnswers,
  type ServiceNowEditAction,
} from '../../packages/contracts/src/index.ts';
import { axeInEveryTheme } from './connector-cards.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { animationsSettled } from './settle.ts';
import { seedChats } from './sidebar-seed.ts';
import { STUB_URL } from './ticket-seed.ts';

const SHOTS = process.env.SERVICENOW_SHOTS ?? '';

test.describe.configure({ timeout: 120_000 });

const RECORD = {
  table: 'incident' as const,
  number: 'INC0010023',
  sysId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  title: 'VPN drops every 20 minutes for remote staff',
  url: `${STUB_URL}/nav_to.do?uri=incident.do%3Fsys_id%3Da1b2c3d4e5f60718293a4b5c6d7e8f90`,
  caller: 'Sam Ortiz',
};

function edit(overrides: Partial<ServiceNowEditAction>): ServiceNowEditAction {
  return {
    action: 'servicenow_edit',
    op: 'work_note',
    record: RECORD,
    updated: '2026-10-20 14:03:11',
    changes: {},
    before: null,
    after: null,
    note: null,
    move: null,
    ...overrides,
  };
}

const workNote = edit({ note: 'Root cause: GlobalProtect idle timeout is 1200 s.' });
const comment = edit({
  op: 'comment',
  note: 'Hi Sam, we found the cause of the VPN drops and are testing a fix today.',
});
const resolve = edit({
  op: 'move',
  move: {
    from: 'In Progress',
    to: 'Resolved',
    value: '6',
    final: true,
    closeCode: 'Solved (Permanently)',
    closeNotes: 'Raised the gateway idle timeout to 8 h.',
  },
});

function cardFor(action: ServiceNowEditAction) {
  const answers = serviceNowAnswers(action);
  return {
    kind: 'spark_action',
    title: `${answers.question} ${RECORD.number} ${RECORD.title}`,
    payload: {
      sparkAction: action,
      sparkResult: { state: 'waiting', message: null, url: null },
      sparkRequested: true,
    },
    options: [
      { optionId: SPARK_ACTION_OPTION.confirm, name: answers.confirm, kind: 'allow_once' },
      { optionId: SPARK_ACTION_OPTION.decline, name: answers.decline, kind: 'reject_once' },
    ],
  };
}

async function openChat(page: Page, title: string) {
  await openChats(page);
  await page
    .getByRole('navigation', { name: 'Chats' })
    .getByRole('button', { name: new RegExp(`^${title}`) })
    .click();
}

async function shoot(page: Page, name: string, target: Locator) {
  if (!SHOTS) return;
  await page.setViewportSize({ width: 1280, height: 1400 });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() => delete document.documentElement.dataset.skin);
    await animationsSettled(page);
    await target.screenshot({ path: `${SHOTS}/${name}-${scheme}.png` });
  }
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('a work note card follows the mode and says it is internal', async ({ page }) => {
  await seedChats([
    { title: 'VPN drops', run: { status: 'awaiting_approval' }, approval: cardFor(workNote) },
  ]);
  await openChat(page, 'VPN drops');
  const card = page.getByRole('group', { name: /Add a work note\?/ });
  await expect(card).toContainText('asks Spark to do this in ServiceNow.');
  await expect(card).toContainText('Internal');
  await expect(card).toContainText('GlobalProtect idle timeout');
  await expect(card).not.toContainText('asks in every mode');
  await expect(card.getByRole('button', { name: 'Add work note' })).toBeVisible();
  await shoot(page, 'work-note-card', card);
});

test('a comment the caller sees always asks and names the caller', async ({ page }) => {
  await seedChats([
    { title: 'VPN drops', run: { status: 'awaiting_approval' }, approval: cardFor(comment) },
  ]);
  await openChat(page, 'VPN drops');
  const card = page.getByRole('group', { name: /Post a comment the caller sees\?/ });
  await expect(card).toContainText('Sam Ortiz (caller) and watchers');
  await expect(card).toContainText('Caller sees it');
  await expect(card).toContainText('This asks in every mode.');
  await expect(card).toHaveClass(/sac-caller/);
  await expect(card.getByRole('button', { name: 'Post comment' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Don’t post' })).toBeVisible();
  await shoot(page, 'comment-card', card);
  await axeInEveryTheme(page, '.sac');
});

test('a resolve card shows the state and resolution before and after', async ({ page }) => {
  await seedChats([
    { title: 'VPN drops', run: { status: 'awaiting_approval' }, approval: cardFor(resolve) },
  ]);
  await openChat(page, 'VPN drops');
  const card = page.getByRole('group', { name: /Resolve INC0010023\?/ });
  await expect(card).toContainText(/State.*In Progress.*→.*Resolved/);
  await expect(card).toContainText('Solved (Permanently)');
  await expect(card).toContainText(/Resolution notes.*Caller sees it.*idle timeout to 8 h/);
  await expect(card.getByRole('link', { name: `INC0010023 · ${RECORD.title}` })).toHaveAttribute(
    'href',
    RECORD.url,
  );
  await expect(card.getByRole('button', { name: 'Resolve', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Don’t resolve' })).toBeVisible();
  await shoot(page, 'resolve-card', card);
  await axeInEveryTheme(page, '.sac');
});
