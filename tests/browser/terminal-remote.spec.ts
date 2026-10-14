import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { RemoteSession, RemoteSwitches } from '../../packages/contracts/src/remote.ts';
import type { TerminalRemoteView } from '../../packages/contracts/src/native-terminal-remote.ts';
import { resetTestDatabase } from './database.ts';
import { startFixtureTerminal } from './native-terminal-fixture.ts';

const PHONE = { width: 390, height: 844 };

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

async function asPairedPhone(page: Page, switches: Partial<RemoteSwitches>): Promise<void> {
  await page.route('**/api/remote/session', async (route) => {
    const response = await route.fetch();
    const session = (await response.json()) as RemoteSession;
    await route.fulfill({
      response,
      json: {
        ...session,
        remote: true,
        device: { id: '00000000-0000-4000-8000-000000000001', name: 'Test phone' },
        address: 'https://mac.tail.test',
        switches: { ...session.switches, ...switches },
      },
    });
  });
  await page.setViewportSize(PHONE);
  await page.reload();
}

test('a paired phone follows a Terminal session and types into it', async ({ page }) => {
  const mac = await startFixtureTerminal(page);
  await expect(mac.locator('.xterm-accessibility')).toBeVisible();
  await asPairedPhone(page, { terminal: true, terminalApprove: true });

  const phone = page.getByRole('region', { name: 'Terminal session', exact: true });
  await expect(phone.getByRole('status').first()).toContainText('Codex · ');
  await expect(phone.locator('.xterm')).toHaveCount(0);
  const box = phone.getByRole('textbox', { name: 'Message the agent' });
  await box.fill('hello from the phone');
  await phone.getByRole('button', { name: 'Send' }).click();
  await expect(box).toHaveValue('');

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  const reopened = page.getByRole('region', { name: 'Terminal session', exact: true });
  await expect(reopened.locator('.xterm-accessibility')).toContainText(']: hello from the phone');
});

test('with the switch off the phone only points to the Mac', async ({ page }) => {
  await startFixtureTerminal(page);
  await asPairedPhone(page, { terminal: false, terminalApprove: false });
  const phone = page.getByRole('main');
  await expect(phone.getByText('Open this Terminal session on your Mac.')).toBeVisible();
  await expect(
    phone.getByText(/Turned off for remote control on your Mac: following, typing in and stopping/),
  ).toBeVisible();
  await expect(phone.getByRole('textbox', { name: 'Message the agent' })).toHaveCount(0);
});

test('an approval shows the request, sends the answer and holds back a message until then', async ({
  page,
}) => {
  await startFixtureTerminal(page);
  const approval = {
    id: '00000000-0000-4000-8000-0000000000a1',
    tool: 'Bash',
    detail: 'pnpm test',
  };
  let answered: unknown = null;
  await page.route('**/terminal/transcript', async (route) => {
    const view: TerminalRemoteView = {
      provider: 'codex',
      state: 'waiting_for_permission',
      running: true,
      items: [
        { id: 'u1', kind: 'user', text: 'Run the tests', tool: null, at: null },
        { id: 't1', kind: 'tool', text: 'pnpm test', tool: 'Bash', at: null },
      ],
      truncated: false,
      approval: answered ? null : { ...approval, denyStopsTurn: true },
    };
    await route.fulfill({ json: view });
  });
  await page.route('**/terminal/approval', async (route) => {
    answered = route.request().postDataJSON();
    await route.fulfill({ status: 204 });
  });
  await asPairedPhone(page, { terminal: true, terminalApprove: true });

  const phone = page.getByRole('region', { name: 'Terminal session', exact: true });
  const card = phone.getByRole('region', { name: 'Permission needed: Running a command' });
  await expect(card).toContainText('pnpm test');
  await expect(phone.getByText('Answer the agent first, then send your message.')).toBeVisible();
  await expect(phone.getByRole('button', { name: 'Send' })).toBeDisabled();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const results = await new AxeBuilder({ page })
      .include('.native-workspace.rt')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const serious = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect([scheme, serious.map((violation) => violation.id)]).toEqual([scheme, []]);
  }
  await card.getByRole('button', { name: 'Deny and stop the turn' }).click();
  await expect.poll(() => answered).toEqual({ id: approval.id, decision: 'deny' });
  await expect(card).toHaveCount(0);
});

test('without the approve switch the card says to answer on the Mac', async ({ page }) => {
  await startFixtureTerminal(page);
  await page.route('**/terminal/transcript', async (route) => {
    await route.fulfill({
      json: {
        provider: 'claude',
        state: 'waiting_for_permission',
        running: true,
        items: [],
        truncated: false,
        approval: {
          id: '00000000-0000-4000-8000-0000000000a2',
          tool: 'Edit',
          detail: 'src/app.ts',
          denyStopsTurn: false,
        },
      } satisfies TerminalRemoteView,
    });
  });
  await asPairedPhone(page, { terminal: true, terminalApprove: false });
  const card = page.getByRole('region', { name: 'Permission needed: Editing a file' });
  await expect(card).toContainText('approving in Terminal sessions. Answer on your Mac.');
  await expect(card.getByRole('button')).toHaveCount(0);
});
