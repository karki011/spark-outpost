import { expect, test, type Page } from '@playwright/test';
import {
  autonomyChip,
  card,
  crewChat,
  crewRepo,
  linkedChat,
  pickAutonomy,
  permissionChip,
  pickerPanel,
  pickMode,
  resetCrew,
  send,
  workPanel,
  type CrewRepo,
} from './crew-engine.ts';

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

const pickerButton = (page: Page) => page.getByRole('button', { name: /^Model and effort/ });

async function openPermissions(page: Page) {
  await pickerButton(page).click();
  const panel = pickerPanel(page);
  await panel.getByRole('tab', { name: /Permissions/ }).click();
  return panel;
}

test("the picker lists the agent's own modes and says what each combination does", async ({
  page,
}) => {
  await linkedChat(page, repo);
  await expect(permissionChip(page)).toHaveAccessibleName('Permissions: Plan');
  const panel = await openPermissions(page);
  const modes = panel.getByRole('radiogroup', { name: 'Agent mode' });
  await expect(modes.getByRole('radio')).toHaveText([
    /^Manual.*Always ask before making changes/,
    /^Accept edits.*Automatically accept all file edits/,
    /^Plan.*Create a plan before making changes/,
    /^Auto.*Claude handles permission decisions/,
    /^Bypass permissions.*Accepts all permissions/,
  ]);
  await expect(modes.getByRole('radio', { name: 'Auto', exact: true })).toContainText('Default');
  await expect(modes.getByRole('radio', { name: 'Manual', exact: true })).not.toContainText(
    'Default',
  );
  await expect(modes.getByRole('radio', { name: 'Plan', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(panel).toContainText('Agent only reads · nothing changes');

  await pickMode(page, 'Accept edits');
  await expect(permissionChip(page)).toHaveAccessibleName('Permissions: Accept edits');
  await expect(pickerButton(page)).toHaveAccessibleName(/^Model and effort: [^·]+$/);
  await expect(permissionChip(page)).not.toContainText('Automatic');
  await expect(panel.getByRole('radiogroup', { name: /autonomy/i })).toHaveCount(0);
  await expect(panel.getByRole('tab', { name: /Permissions/ })).toHaveText(/Accept edits$/);
  await expect(panel).toContainText(
    'Edits go through, commands ask · kept automatically · Revert available',
  );
  await expect(panel.getByRole('note')).toHaveCount(0);

  await pickMode(page, 'Bypass permissions');
  await expect(panel.getByRole('note')).toContainText('Nothing asks first on your real checkout');
  await pickAutonomy(page, 'Full auto → PR');
  await openPermissions(page);
  await expect(panel).toContainText('in a worktree copy');
  await expect(panel.getByRole('note')).toHaveCount(0);

  await pickMode(page, 'Plan');
  await expect(panel.getByRole('tab', { name: /Permissions/ })).toHaveText(/Plan$/);
  await expect(permissionChip(page)).toHaveAccessibleName('Permissions: Plan');
});

test('the permission chip names the mode and opens the picker on Permissions', async ({ page }) => {
  await linkedChat(page, repo);
  const chip = permissionChip(page);
  await expect(chip).toHaveAccessibleName('Permissions: Plan');
  await expect(chip).toHaveText('Plan');
  await expect(chip).toHaveAttribute('aria-haspopup', 'dialog');

  await chip.click();
  const panel = pickerPanel(page);
  await expect(panel).toBeVisible();
  const tab = panel.getByRole('tab', { name: /Permissions/ });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(tab).toBeFocused();
  await expect(panel.getByRole('radiogroup', { name: 'Agent mode' })).toBeVisible();

  await pickMode(page, 'Auto');
  await expect(chip).toHaveAccessibleName('Permissions: Auto');
  await expect(chip).toHaveText('Auto');
  await expect(tab).toHaveText(/Auto$/);
  await expect(chip).not.toHaveClass(/risk-full/);

  await pickMode(page, 'Bypass permissions');
  await expect(chip).toHaveAccessibleName('Permissions: Bypass permissions');
  await expect(chip).toHaveText('Bypass');
  await expect(chip).toHaveClass(/risk-full/);

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(chip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(tab).toBeFocused();
  await chip.click();
  await expect(panel).toBeHidden();

  await pickerButton(page).click();
  await expect(panel.getByRole('tab', { name: /^Model/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(pickerButton(page)).toBeFocused();
});

test('the permission chip keeps the composer bar on one line at phone width', async ({ page }) => {
  await linkedChat(page, repo);
  await page.setViewportSize({ width: 360, height: 780 });
  const chip = permissionChip(page);
  await expect(chip).toHaveAccessibleName('Permissions: Plan');
  await expect(chip.locator('.pchip-name')).toBeHidden();
  await expect(chip.locator('svg')).toBeVisible();
  const bar = page.locator('.comp-bar');
  const send = bar.locator('.send');
  const [chipBox, sendBox] = [await chip.boundingBox(), await send.boundingBox()];
  expect(
    Math.abs(
      (chipBox?.y ?? 0) +
        (chipBox?.height ?? 0) / 2 -
        ((sendBox?.y ?? 0) + (sendBox?.height ?? 0) / 2),
    ),
  ).toBeLessThan(6);
  expect(await bar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await chip.click();
  await expect(pickerPanel(page).getByRole('tab', { name: /Permissions/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('Spark autonomy lives in the Work panel and the context bar chip opens it', async ({
  page,
}) => {
  await linkedChat(page, repo);
  const chip = autonomyChip(page);
  await expect(chip).toHaveAccessibleName('Spark autonomy: Automatic');
  await expect(chip).toHaveText('Automatic');
  await expect(workPanel(page)).not.toHaveClass(/\bon\b/);

  await chip.click();
  const panel = page.getByRole('complementary', { name: 'Work panel' });
  await expect(panel).toBeVisible();
  const levels = panel.getByRole('radiogroup', { name: 'Spark autonomy' });
  await expect(levels.getByRole('radio')).toHaveText([
    /^Review each step.*You decide what to keep/,
    /^Automatic.*Runs commands and keeps passing changes/,
    /^Full auto → PR.*opens a PR/,
  ]);
  const automatic = levels.getByRole('radio', { name: 'Automatic', exact: true });
  await expect(automatic).toBeFocused();
  await expect(panel).toContainText('Applies to this chat. New chats start with your defaults.');

  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/settings') && response.request().method() === 'PATCH',
  );
  await levels.getByRole('radio', { name: 'Review each step', exact: true }).click();
  expect((await saved).request().postDataJSON()).toEqual({ level: 'balanced' });
  await expect(chip).toHaveAccessibleName('Spark autonomy: Review each step');
  await expect(panel.getByRole('button', { name: /^Spark autonomy/ })).toContainText(
    'Review each step',
  );
  await expect(pickerButton(page)).not.toContainText('Review each step');

  await panel.getByRole('button', { name: 'Hide work panel' }).click();
  await expect(panel).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await autonomyChip(page).click();
  const sheet = page.getByRole('complementary', { name: 'Work panel' });
  await expect(sheet).toBeInViewport();
  const fullAuto = sheet
    .getByRole('radiogroup', { name: 'Spark autonomy' })
    .getByRole('radio', { name: 'Full auto → PR', exact: true });
  await fullAuto.click();
  await expect(fullAuto).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(autonomyChip(page)).toHaveAccessibleName('Spark autonomy: Full auto → PR');
});

test('modes and options reported by a live run show up in the picker', async ({ page }) => {
  test.setTimeout(90_000);
  await linkedChat(page, repo);
  await pickerButton(page).click();
  await expect(pickerPanel(page).getByRole('tab', { name: /Options/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await send(page, 'Say hello #build');

  const panel = await openPermissions(page);
  const yolo = panel
    .getByRole('radiogroup', { name: 'Agent mode' })
    .getByRole('radio', { name: 'Yolo', exact: true });
  await expect(yolo).toContainText('Custom mode from the fake agent', { timeout: 45_000 });
  await panel.getByRole('tab', { name: /Options/ }).click();
  const fast = panel.getByRole('switch', { name: 'Fast mode' });
  await expect(fast).toContainText('Faster replies at a higher price');
  await expect(fast).toHaveAttribute('aria-checked', 'false');
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/settings') && response.request().method() === 'PATCH',
  );
  await fast.click();
  expect((await saved).request().postDataJSON()).toEqual({ options: { fast: true } });
  await expect(fast).toHaveAttribute('aria-checked', 'true');
});

test("the approval card offers every option the agent sent, with the agent's words", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await crewChat(page, repo, 'Ask before edits');
  const choices: [string, string, RegExp][] = [
    ['Yes', 'yes', /^Chose: Yes\./],
    ["Yes, and don't ask again for npm test commands", 'yes-always', /Allowed for this run\./],
    ['No', 'no', /^Chose: No\./],
    ["No, and don't ask again", 'no-always', /Rejected for the rest of this run\./],
  ];
  for (const [index, [label, optionId, result]] of choices.entries()) {
    await send(page, `Run the tests #fourkinds #build ${index}`);
    const approval = card(page, /Run a command\?/).last();
    await expect(approval.getByRole('button')).toHaveText(
      [
        'Yes',
        "Yes, and don't ask again for npm test commands",
        'Always allow in this project',
        'No',
        "No, and don't ask again",
      ],
      { timeout: 30_000 },
    );
    await expect(approval.getByRole('button', { name: 'Yes', exact: true })).toHaveClass(/primary/);
    await expect(approval.getByRole('button', { name: 'No', exact: true })).toHaveClass(/deny/);
    await approval.getByRole('button', { name: label, exact: true }).click();
    await expect(approval.getByRole('status')).toContainText(`Chose: ${label}.`);
    await expect(approval.getByRole('status')).toContainText(result);
    await expect(page.getByText(`permission=${optionId}`, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('.crew-turn .crew-foot').last()).toContainText('Done', {
      timeout: 30_000,
    });
  }
  await page.reload();
  await expect(card(page, /Run a command\?/).getByRole('status')).toHaveText(
    choices.map(([, , result]) => result),
  );
});

test('retiring models stay hidden until you ask for them', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-29T12:00:00Z'));
  await linkedChat(page, repo);
  await pickerButton(page).click();
  const models = pickerPanel(page).getByRole('radiogroup', { name: 'Claude model' });
  await expect(models.getByRole('radio', { name: /Sonnet 5/ })).toBeVisible();
  await expect(models.getByRole('radio', { name: /Haiku 4\.5/ })).toHaveCount(0);

  const toggle = pickerPanel(page).getByRole('switch', { name: 'Show retiring models' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  const haiku = models.getByRole('radio', { name: /Haiku 4\.5/ });
  await expect(haiku).toContainText('Retiring Oct 15, 2026');
  await haiku.click();
  await expect(haiku).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(haiku).toBeVisible();
  await expect(haiku).toContainText('Retiring Oct 15, 2026');
});

test('Settings sets the default mode and autonomy that new chats start with', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Spark' })
    .getByRole('tab', { name: /AI providers/ })
    .click();
  const providers = page.getByRole('dialog', { name: 'AI providers' });
  const claude = providers.locator('.pcard').filter({ hasText: 'Claude' });
  await claude.locator('.pc-head').click();
  const mode = claude.getByRole('button', { name: 'Claude default mode' });
  await expect(mode).toHaveText('Plan');
  await mode.click();
  await page.getByRole('menuitemradio', { name: /^Accept edits/ }).click();
  await expect(mode).toHaveText('Accept edits');
  await expect(claude.getByRole('button', { name: 'Claude harness autonomy' })).toHaveCount(0);
  await providers.getByRole('tab', { name: 'Spark', exact: true }).click();
  const autonomy = page
    .getByRole('dialog', { name: 'Spark' })
    .getByRole('radiogroup', { name: 'How much Spark does alone' });
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/profile') && response.ok(),
  );
  await autonomy.getByRole('radio', { name: 'Review each step' }).click();
  await saved;
  await page.keyboard.press('Escape');

  await linkedChat(page, repo);
  await expect(permissionChip(page)).toHaveAccessibleName('Permissions: Accept edits');
  await expect(autonomyChip(page)).toHaveAccessibleName('Spark autonomy: Review each step');
  await autonomyChip(page).click();
  await expect(
    workPanel(page)
      .getByRole('radiogroup', { name: 'Spark autonomy' })
      .getByRole('radio', { name: 'Review each step', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
});
