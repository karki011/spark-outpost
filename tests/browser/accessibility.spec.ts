import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { connectorCard, connectorHead } from './connector-cards.ts';
import { resetTestDatabase } from './database.ts';
import { editedChat } from './edited-chat.ts';
import { seedChats } from './sidebar-seed.ts';
import { combinedFixture, monoFixture, REPO_ROOT, serveMap } from './map-fixture.ts';
import { nxFixture } from './map-nx-fixture.ts';
import { openChats } from './navigation.ts';
import { seedFlowChats } from './ticket-flow-seed.ts';
import { connectTickets, openTickets, resetTicketFakes, STUB_URL } from './ticket-seed.ts';
import { JIRA_EMAIL } from '../../apps/server/test/fake-jira.ts';

const THEMES = [
  'light',
  'graphite',
  'apricot',
  'void',
  'fjord',
  'moss',
  'lagoon',
  'plum',
  'sage',
  'aurora',
  'iris',
  'contrast',
] as const;
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

const axeCore = createRequire(import.meta.resolve('@axe-core/playwright'))('axe-core') as {
  getRules(tags: string[]): { ruleId: string }[];
};
const isColourOrAria = (rule: string) => rule === 'color-contrast' || rule.startsWith('aria-');
const CHECKED_RULES = axeCore
  .getRules(WCAG_TAGS)
  .map((rule) => rule.ruleId)
  .filter(isColourOrAria);

const TEXT_SPACING_CSS = `
  * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
  p { margin-bottom: 2em !important; }
`;

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([
    { title: 'Current chat' },
    {
      title: 'Run the suite',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'Run tests', command: 'pnpm test' },
    },
    { title: 'Ship the notes', run: { status: 'succeeded' }, unread: true },
    { title: 'Mock fetch', run: { status: 'failed', error: 'Rate limit reached.' } },
  ]);
});

async function openWorkedChat(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Fix the date divider #plan');
  await input.press('Enter');
  await expect(page.locator('.taskc')).toContainText('Task 7/7', { timeout: 20_000 });
}

async function useTheme(page: Page, theme: string) {
  await page.evaluate((skin) => (document.documentElement.dataset.skin = skin), theme);
  await page.evaluate(() => document.fonts.ready);
}

function isBlocking(violation: { id: string; impact?: string | null }): boolean {
  return isColourOrAria(violation.id) && BLOCKING_IMPACTS.has(violation.impact ?? '');
}

async function settle(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' ||
          animation.effect?.getTiming().iterations === Infinity,
      ),
  );
}

async function blockingViolations(page: Page, screen: string) {
  await settle(page);
  const results = await new AxeBuilder({ page })
    .withRules(CHECKED_RULES)
    .setLegacyMode(true)
    .analyze();
  return results.violations.filter(isBlocking).map((violation) => ({
    screen,
    rule: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }));
}

for (const theme of THEMES) {
  test(`${theme} theme has no serious colour-contrast or ARIA issues on the main screens`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openWorkedChat(page);
    await useTheme(page, theme);
    const found = await blockingViolations(page, 'chat with work panel');

    await page.getByRole('button', { name: 'Settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Spark' });
    await expect(settings).toBeVisible();
    found.push(...(await blockingViolations(page, 'settings spark')));
    await settings.getByRole('tab', { name: 'Appearance' }).click();
    await expect(page.getByRole('dialog', { name: 'Appearance' })).toBeVisible();
    found.push(...(await blockingViolations(page, 'settings appearance')));
    await page
      .getByRole('dialog', { name: 'Appearance' })
      .getByRole('tab', { name: 'Models' })
      .click();
    await expect(
      page.getByRole('dialog', { name: 'Models' }).getByRole('region', { name: 'Claude' }),
    ).toBeVisible();
    found.push(...(await blockingViolations(page, 'settings models')));
    await page.getByRole('dialog', { name: 'Models' }).getByRole('tab', { name: 'Reset' }).click();
    const hold = page.getByRole('dialog', { name: 'Reset' }).locator('.hold-btn');
    await expect(hold).toBeVisible();
    found.push(...(await blockingViolations(page, 'settings reset')));

    await page.getByRole('button', { name: 'Close settings' }).click();
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: /^Home/ })
      .click();
    await expect(page.getByRole('list', { name: 'Needs you' })).toBeVisible();
    await expect(page.locator('.feed-foot')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Spend' }).locator('.cost-total')).toBeVisible();
    found.push(...(await blockingViolations(page, 'home')));

    expect(found).toEqual([]);
  });
}

test('the Tickets screen has no serious colour-contrast or ARIA issues in any theme', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await resetTicketFakes();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openTickets(page);
  await page.getByRole('button', { name: 'Connect Jira' }).click();
  const found = await blockingViolations(page, 'tickets connect');

  await connectTickets(page);
  await page.request.get('/api/tickets/inbox');
  await seedFlowChats([
    { key: 'WEB-433', source: 'linear', status: 'running', spark: 'Pip' },
    { key: 'WEB-421', source: 'linear', status: 'failed' },
    { key: 'API-84', source: 'jira', status: 'succeeded' },
  ]);
  await openTickets(page);
  const row = page.locator('li[data-ticket$=":WEB-433"]');
  await row.getByRole('button').first().click({ timeout: 15_000 });
  await expect(page.getByRole('complementary', { name: 'WEB-433 details' })).toBeVisible();
  for (const theme of THEMES) {
    await useTheme(page, theme);
    found.push(...(await blockingViolations(page, `tickets inbox ${theme}`)));
  }

  await useTheme(page, 'light');
  await page.getByRole('searchbox').fill('upload');
  await page.locator('li[data-ticket$=":WEB-437"]').hover();
  await page.getByRole('button', { name: 'Assign WEB-437 to me' }).click();
  await expect(page.getByRole('dialog', { name: /Take WEB-437/ })).toBeVisible();
  found.push(...(await blockingViolations(page, 'tickets search with confirm')));

  expect(found).toEqual([]);
});

test('Home and the Tickets brief strip have no serious issues with a brief and a row action showing', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await resetTicketFakes();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('spark-outpost.view', 'tickets'));
  await connectTickets(page);
  await openTickets(page);
  await expect(page.locator('li[data-ticket$=":WEB-433"]')).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Home/ })
    .click();
  const today = page.getByRole('region', { name: /^What needs you today/ });
  await expect(today.getByRole('list', { name: 'Do these first' })).toBeVisible({
    timeout: 15_000,
  });
  await today.locator('.lr-main').first().focus();
  await expect(today.locator('.lr-acts').first()).toHaveCSS('opacity', '1');
  const found = [];
  for (const theme of ['light', 'graphite', 'contrast']) {
    await useTheme(page, theme);
    found.push(...(await blockingViolations(page, `home brief ${theme}`)));
  }

  await today
    .getByRole('button', { name: /^Open [A-Z]+-\d+$/ })
    .first()
    .click();
  const strip = page.getByRole('main', { name: 'Tickets' }).locator('.brief');
  await expect(strip.getByRole('listitem').first()).toBeVisible();
  for (const theme of ['light', 'graphite', 'contrast']) {
    await useTheme(page, theme);
    found.push(...(await blockingViolations(page, `tickets brief strip ${theme}`)));
  }
  expect(found).toEqual([]);
});

test('Settings → Connectors has no serious colour-contrast or ARIA issues', async ({ page }) => {
  test.setTimeout(90_000);
  await resetTicketFakes();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Connectors' }).click();
  const jira = connectorCard(page, 'jira');
  await connectorHead(jira).click();
  const form = jira.getByRole('form', { name: 'Connect Jira' });
  await form.getByLabel('Site URL').fill(STUB_URL);
  await form.getByLabel('Email').fill(JIRA_EMAIL);
  await form.getByLabel('API token').fill('jira_wrong_token_0123456789');
  await form.getByRole('button', { name: 'Save and check' }).click();
  await expect(form.locator('.cb[data-mood="sad"]')).toBeVisible();
  const found = [];
  for (const theme of ['light', 'graphite', 'contrast']) {
    await useTheme(page, theme);
    found.push(...(await blockingViolations(page, `connectors error ${theme}`)));
  }

  await connectTickets(page, ['jira']);
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Connectors' }).click();
  await connectorHead(jira).click();
  await expect(
    jira.getByRole('switch', { name: 'Move tickets to Done when the PR merges' }),
  ).toBeVisible();
  for (const theme of ['light', 'graphite', 'contrast']) {
    await useTheme(page, theme);
    found.push(...(await blockingViolations(page, `connectors connected ${theme}`)));
  }
  expect(found).toEqual([]);
});

test('the Docs page has no serious colour-contrast or ARIA issues in any theme', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/docs/approvals#protected-paths');
  const docs = page.getByRole('main', { name: 'Docs' });
  await expect(docs.getByRole('heading', { name: 'Protected paths', level: 2 })).toBeFocused();
  const found = [];
  for (const theme of THEMES) {
    await useTheme(page, theme);
    found.push(...(await blockingViolations(page, `docs page ${theme}`)));
  }
  await docs.getByRole('searchbox', { name: 'Search the guide' }).fill('autonomy');
  await expect(docs.getByRole('list', { name: 'Search results' })).toBeVisible();
  for (const theme of ['light', 'graphite', 'contrast']) {
    await useTheme(page, theme);
    found.push(...(await blockingViolations(page, `docs search ${theme}`)));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await docs.getByRole('searchbox', { name: 'Search the guide' }).fill('');
  await docs.getByRole('button', { name: 'Contents' }).click();
  found.push(...(await blockingViolations(page, 'docs phone contents')));
  expect(found).toEqual([]);
});

test('the changes chip, drawer and Changes tab have no serious issues in any theme', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-a11y-diff-')));
  try {
    writeFileSync(path.join(root, 'notes.txt'), 'Remember the milk\n');
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await editedChat(page, root);
    const panel = page.getByRole('complementary', { name: 'Work panel' });
    const show = page.getByRole('button', { name: 'Show work panel' });
    if (await show.isVisible()) await show.click();
    await panel.getByRole('tab', { name: 'Changes' }).click();
    await expect(panel.getByRole('region', { name: 'Most changed files' })).toBeVisible();
    await page.getByRole('button', { name: /added, \d+ removed in 1 file$/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Changes · 1 file' });
    await drawer.getByRole('treeitem', { name: /notes\.txt/ }).click();
    await expect(drawer.locator('.cm-content')).toContainText('Edited by the fake agent');
    const found = [];
    for (const theme of THEMES) {
      await useTheme(page, theme);
      found.push(...(await blockingViolations(page, `changes drawer ${theme}`)));
    }
    expect(found).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('interactive targets on the chat screen are at least 24 by 24 pixels', async ({ page }) => {
  await openWorkedChat(page);
  const small = await page.evaluate(() => {
    const selector =
      'button, a[href], [role="button"], [role="tab"], [role="menuitem"], input[type="checkbox"], input[type="radio"], summary';
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => element.checkVisibility({ visibilityProperty: true }))
      .filter((element) => getComputedStyle(element).display !== 'inline')
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && (box.width < 23.5 || box.height < 23.5))
      .map(({ element, box }) => {
        const name = element.getAttribute('aria-label') ?? element.textContent ?? '';
        return `${Math.round(box.width)}x${Math.round(box.height)} ${name.trim().slice(0, 40)}`;
      });
  });
  expect(small).toEqual([]);
});

test('text spacing overrides do not clip button or tab labels', async ({ page }) => {
  await openWorkedChat(page);
  await page.addStyleTag({ content: TEXT_SPACING_CSS });
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, [role="tab"]')]
      .filter((element) => element.checkVisibility({ visibilityProperty: true }))
      .filter((element) => getComputedStyle(element).overflowY !== 'visible')
      .filter((element) => element.scrollHeight > element.clientHeight + 1)
      .map((element) => (element.getAttribute('aria-label') ?? element.textContent ?? '').trim()),
  );
  expect(clipped).toEqual([]);
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
});

test('the chat screen reflows at 200% zoom without horizontal scrolling', async ({ page }) => {
  await openWorkedChat(page);
  await page.setViewportSize({ width: 640, height: 450 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const input = page.getByRole('textbox', { name: 'Message' });
  await expect(input).toBeInViewport();
  await input.fill('Still reachable');
  await expect(page.getByRole('button', { name: /^Send/ })).toBeInViewport();
});

test('the Map has no serious colour-contrast or ARIA issues in any theme', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const post = (rootPath: string) => page.request.post('/api/projects', { data: { rootPath } });
  const web = ((await (await post(path.join(REPO_ROOT, 'apps/web'))).json()) as { id: string }).id;
  const server = (
    (await (await post(path.join(REPO_ROOT, 'apps/server'))).json()) as { id: string }
  ).id;
  await serveMap(page, combinedFixture(web, server));
  await page.addInitScript(
    (ids) => {
      localStorage.setItem('spark-outpost.view', 'map');
      localStorage.setItem('spark-outpost.map-view', '"sky"');
      localStorage.setItem('spark-outpost.map-projects', JSON.stringify(ids));
    },
    [web],
  );
  await page.goto('/');
  await expect(page.getByRole('application', { name: /Project map of/ })).toBeVisible();
  const found = [];
  for (const theme of THEMES) {
    await useTheme(page, theme);
    found.push(...(await blockingViolations(page, `map sky ${theme}`)));
  }
  await page.getByRole('button', { name: 'Review areas' }).click();
  await expect(page.getByRole('dialog', { name: 'Review areas' })).toBeVisible();
  for (const theme of ['light', 'graphite', 'contrast']) {
    await useTheme(page, theme);
    found.push(...(await blockingViolations(page, `map review ${theme}`)));
  }
  await page.getByRole('button', { name: 'Close review' }).click();
  await page.getByRole('combobox', { name: 'Find a file on the map' }).fill('client.ts');
  await page
    .getByRole('option', { name: /client\.ts/ })
    .first()
    .click();
  const { x, y, width, height } = (await page.locator('.map-stage').boundingBox())!;
  await page.mouse.click(x + width / 2, y + height / 2);
  await expect(page.getByRole('dialog', { name: 'client.ts' })).toBeVisible();
  for (const theme of ['light', 'graphite', 'contrast']) {
    await useTheme(page, theme);
    found.push(...(await blockingViolations(page, `map file sheet ${theme}`)));
  }
  await page.getByRole('button', { name: 'Close file details' }).click();
  await page.getByRole('button', { name: /^Projects on the map/ }).click();
  await page.getByRole('menuitemcheckbox', { name: /^server/ }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Unmatched/ }).click();
  await expect(page.getByRole('region', { name: 'Unmatched' })).toBeVisible();
  for (const theme of ['light', 'graphite', 'contrast']) {
    await useTheme(page, theme);
    found.push(...(await blockingViolations(page, `map combined ${theme}`)));
  }
  expect(found).toEqual([]);
});

test('the Tree, Outline and Focus views have no serious issues in any theme', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const response = await page.request.post('/api/projects', { data: { rootPath: REPO_ROOT } });
  const projectId = ((await response.json()) as { id: string }).id;
  await serveMap(page, nxFixture(projectId));
  await page.addInitScript(() => localStorage.setItem('spark-outpost.view', 'map'));
  await page.goto('/');
  const tree = page.getByRole('application', { name: /^Tree of/ });
  await expect(tree.getByRole('button', { name: /^ui, group/ })).toBeVisible();
  const found = [];
  for (const theme of THEMES) {
    await useTheme(page, theme);
    found.push(...(await blockingViolations(page, `map tree ${theme}`)));
  }
  await tree.getByRole('button', { name: /^ui, group/ }).focus();
  await page.keyboard.press('Enter');
  await expect(tree.getByRole('button', { name: /, area, / }).first()).toBeVisible();
  for (const theme of ['light', 'graphite', 'contrast']) {
    await useTheme(page, theme);
    found.push(...(await blockingViolations(page, `map tree open ${theme}`)));
  }
  await page.getByRole('radio', { name: 'Outline' }).click();
  const outline = page.getByRole('tree', { name: /^Outline of/ });
  await outline.getByRole('treeitem', { name: /^ui,/ }).click();
  await expect(outline.locator('[aria-level="2"]').first()).toBeVisible();
  for (const theme of THEMES) {
    await useTheme(page, theme);
    found.push(...(await blockingViolations(page, `map outline ${theme}`)));
  }
  await page.getByRole('radio', { name: 'Focus' }).click();
  await page.getByRole('list', { name: 'Suggested files' }).getByRole('button').first().click();
  await expect(page.getByRole('region', { name: 'What breaks if I change this?' })).toBeVisible();
  for (const theme of THEMES) {
    await useTheme(page, theme);
    found.push(...(await blockingViolations(page, `map focus ${theme}`)));
  }
  expect(found).toEqual([]);
});

test('the empty Map and the build card have no serious issues in any theme', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('spark-outpost.view', 'map'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your code, as a night sky' })).toBeVisible();
  const found = [];
  for (const theme of [...THEMES, 'dark']) {
    await useTheme(page, theme);
    found.push(...(await blockingViolations(page, `map empty ${theme}`)));
  }
  const response = await page.request.post('/api/projects', { data: { rootPath: REPO_ROOT } });
  const projectId = ((await response.json()) as { id: string }).id;
  const fixture = monoFixture(projectId);
  const map = fixture.projects.get(projectId)!;
  map.areas = [];
  map.status = {
    ...map.status,
    status: 'building',
    phase: 'labels',
    progress: { done: 34, total: 268 },
    jevAreas: 268,
  };
  await serveMap(page, fixture);
  await page.reload();
  await expect(page.getByText('Jev is labelling areas · 34 / 268')).toBeVisible();
  for (const theme of [...THEMES, 'dark']) {
    await useTheme(page, theme);
    found.push(...(await blockingViolations(page, `map build card ${theme}`)));
  }
  expect(found).toEqual([]);
});
