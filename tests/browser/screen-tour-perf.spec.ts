import { expect, test, type Locator, type Page } from '@playwright/test';
import { seedAnalytics } from './analytics-seed.ts';
import { resetTestDatabase } from './database.ts';
import { REPO_ROOT, serveMap, syntheticFixture } from './map-fixture.ts';
import {
  CLICK_LIMIT_MS,
  clickFeedbackMs,
  restingBusyPercent,
  PRODUCTION,
  startProbe,
  takeProbe,
  TASK_LIMIT_MS,
  writeReport,
} from './perf-probe.ts';
import { seedLongAudit, seedSparks, seedTourChats, serveBigInbox } from './tour-seed.ts';

test.use({ trace: 'off' });

const IDLE_BUSY_LIMIT = 5;

interface Step {
  clickMs: number;
  openMaxTaskMs: number;
  steadyMaxTaskMs: number;
  slowFrames: number;
  idleBusyPercent: number;
}

const rail = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: new RegExp(`^${name}`) });

async function scrollAll(page: Page, selector: string) {
  await page.evaluate(async (target) => {
    const elements = [...document.querySelectorAll<HTMLElement>(target)].filter(
      (element) => element.scrollHeight > element.clientHeight + 4,
    );
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    for (const element of elements) {
      for (let step = 1; step <= 20; step++) {
        element.scrollTop = ((element.scrollHeight - element.clientHeight) * step) / 20;
        await frame();
      }
      element.scrollTop = 0;
      await frame();
    }
  }, selector);
}

async function typeSlowly(target: Locator, text: string) {
  await target.click();
  await target.pressSequentially(text, { delay: 40 });
  await target.fill('');
}

async function measure(
  page: Page,
  open: Locator,
  ready: Locator,
  steady: () => Promise<void>,
): Promise<Step> {
  await takeProbe(page);
  const clickMs = await clickFeedbackMs(open);
  await expect(ready).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  const opened = await takeProbe(page);
  await steady();
  const steadyProbe = await takeProbe(page);
  return {
    clickMs,
    openMaxTaskMs: opened.maxTaskMs,
    steadyMaxTaskMs: steadyProbe.maxTaskMs,
    slowFrames: steadyProbe.slowFrames,
    idleBusyPercent: await restingBusyPercent(page),
  };
}

async function realChat(page: Page): Promise<void> {
  await page.goto('/');
  await rail(page, 'Chats').click();
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Audit the date helpers #plan');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await input.press('Enter');
  await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible({ timeout: 30_000 });
}

test('every screen opens and stays smooth with heavy data', async ({ page }) => {
  test.setTimeout(400_000);
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await realChat(page);
  await seedLongAudit();
  await seedTourChats();
  await seedAnalytics(90);
  await seedSparks(page);
  await serveBigInbox(page);
  const project = await page.request.post('/api/projects', { data: { rootPath: REPO_ROOT } });
  const projectId = ((await project.json()) as { id: string }).id;
  await serveMap(page, syntheticFixture(projectId, 5_000, 120));
  await page.evaluate((id) => {
    localStorage.setItem('spark-outpost.map-projects', JSON.stringify([id]));
    localStorage.setItem('spark-outpost.map-view', '"sky"');
  }, projectId);
  await page.goto('/');
  await expect(rail(page, 'Home')).toBeVisible();
  await page.waitForTimeout(1_500);
  await startProbe(page);
  const steps: Record<string, Step> = {};

  steps.home = await measure(page, rail(page, 'Home'), page.locator('main:visible').first(), () =>
    scrollAll(page, 'main, main *'),
  );
  const sidebar = page.getByRole('navigation', { name: 'Chats' });
  steps.chats = await measure(page, rail(page, 'Chats'), sidebar, async () => {
    await scrollAll(page, 'nav[aria-label="Chats"] *');
    await typeSlowly(sidebar.getByRole('searchbox', { name: 'Search chats' }), 'image');
  });
  const work = page.getByRole('complementary', { name: 'Work panel' });
  steps.openChat = await measure(
    page,
    sidebar.getByRole('button', { name: /Audit the date helpers/ }).first(),
    page.getByRole('region', { name: 'Turn' }).first(),
    () => scrollAll(page, '.thread, .thread-wrap'),
  );
  const show = page.getByRole('button', { name: 'Show work panel' });
  if (await show.isVisible()) await show.click();
  for (const tab of ['Plan', 'Crew', 'Cost', 'To-do']) {
    const target = work.getByRole('tab', { name: tab });
    if ((await target.count()) === 0) continue;
    steps[`work ${tab}`] = await measure(page, target, target, async () => undefined);
  }
  await work.getByRole('tab', { name: 'Cost' }).click();
  const audit = page.getByRole('dialog', { name: 'Audit this chat' });
  steps.audit = await measure(
    page,
    work.getByRole('button', { name: 'Audit this session' }),
    audit,
    async () => undefined,
  );
  steps.auditLogs = await measure(
    page,
    audit.getByRole('tab', { name: 'Logs' }),
    audit.getByRole('list', { name: 'Protocol messages' }),
    async () => {
      await scrollAll(page, '[role="dialog"] *');
      await typeSlowly(audit.getByRole('searchbox', { name: 'Filter by text' }), 'part-12');
    },
  );
  steps.auditTimeline = await measure(
    page,
    audit.getByRole('tab', { name: 'Timeline' }),
    audit.getByRole('figure').first(),
    () => scrollAll(page, '[role="dialog"] *'),
  );
  await audit.getByRole('button', { name: 'Close audit' }).click();
  await expect(audit).toBeHidden();

  steps.tickets = await measure(
    page,
    rail(page, 'Tickets'),
    page.getByText('TOUR-1', { exact: false }).first(),
    async () => {
      await scrollAll(page, 'main *');
      await typeSlowly(page.getByRole('searchbox').first(), 'TOUR-12');
    },
  );
  steps.map = await measure(
    page,
    rail(page, 'Map'),
    page.getByRole('application', { name: /120 areas/ }),
    async () => undefined,
  );
  steps.analytics = await measure(
    page,
    rail(page, 'Analytics'),
    page.locator('main:visible').first(),
    () => scrollAll(page, 'main, main *'),
  );
  steps.docs = await measure(
    page,
    rail(page, 'Docs'),
    page.locator('main:visible').first(),
    async () => {
      await scrollAll(page, 'main, main *');
      const search = page.getByRole('searchbox').first();
      if (await search.isVisible()) await typeSlowly(search, 'island');
    },
  );
  const settings = page.getByRole('dialog').last();
  steps.settings = await measure(
    page,
    page.getByRole('button', { name: 'Settings' }),
    settings,
    () => scrollAll(page, '[role="dialog"] *'),
  );
  for (const tab of ['AI providers', 'Models', 'Crew', 'Usage', 'Appearance']) {
    const target = settings.getByRole('tab', { name: tab });
    if ((await target.count()) === 0) continue;
    steps[`settings ${tab}`] = await measure(page, target, target, () =>
      scrollAll(page, '[role="dialog"] *'),
    );
  }
  await page.keyboard.press('Escape');

  await page.screenshot({ path: 'test-results/smooth-audit/screen-tour.png' });
  writeReport('screen-tour', { steps });
  test.info().annotations.push({ type: 'screen tour', description: JSON.stringify(steps) });

  for (const [name, step] of Object.entries(steps)) {
    expect.soft(step.clickMs, `${name} click feedback`).toBeLessThan(CLICK_LIMIT_MS);
    expect.soft(step.steadyMaxTaskMs, `${name} steady long task`).toBeLessThan(TASK_LIMIT_MS);
    if (PRODUCTION) {
      expect.soft(step.idleBusyPercent, `${name} idle main thread`).toBeLessThan(IDLE_BUSY_LIMIT);
    }
  }
});
