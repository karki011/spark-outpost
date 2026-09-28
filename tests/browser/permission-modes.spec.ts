import { expect, test, type Page } from '@playwright/test';
import {
  card,
  crewChat,
  crewRepo,
  linkedChat,
  pickAutonomy,
  pickerPanel,
  pickMode,
  resetCrew,
  send,
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
  await expect(pickerButton(page)).toHaveAccessibleName(/· Plan$/);
  const panel = await openPermissions(page);
  const modes = panel.getByRole('radiogroup', { name: 'Agent mode' });
  await expect(modes.getByRole('radio')).toHaveText([
    /^Manual.*Always ask before making changes/,
    /^Accept edits.*Automatically accept all file edits/,
    /^Plan.*Create a plan before making changes/,
    /^Auto.*Claude handles permission decisions/,
    /^Bypass permissions.*Accepts all permissions/,
  ]);
  await expect(modes.getByRole('radio', { name: 'Manual', exact: true })).toContainText('Default');
  await expect(modes.getByRole('radio', { name: 'Plan', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(panel).toContainText('Agent only reads · nothing changes');

  await pickMode(page, 'Accept edits');
  await pickAutonomy(page, 'Automatic');
  await expect(pickerButton(page)).toContainText('· Accept edits · Automatic');
  await expect(pickerButton(page)).toHaveAccessibleName(/· Accept edits · Automatic$/);
  await expect(panel.getByRole('tab', { name: /Permissions/ })).toContainText(
    'Accept edits · Automatic',
  );
  await expect(panel).toContainText(
    'Edits go through, commands ask · kept automatically · Revert available',
  );
  await expect(panel.getByRole('note')).toHaveCount(0);

  await pickMode(page, 'Bypass permissions');
  await expect(panel.getByRole('note')).toContainText('Nothing asks first on your real checkout');
  await pickAutonomy(page, 'Full auto → PR');
  await expect(panel).toContainText('in a worktree copy');
  await expect(panel.getByRole('note')).toHaveCount(0);

  await pickMode(page, 'Plan');
  await expect(panel.getByRole('tab', { name: /Permissions/ })).toHaveText(/Plan$/);
  await expect(pickerButton(page)).toHaveAccessibleName(/· Plan$/);
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
});

test('retiring models stay hidden until you ask for them', async ({ page }) => {
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
    .getByRole('dialog', { name: 'Profile' })
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
  const autonomy = claude.getByRole('button', { name: 'Claude harness autonomy' });
  await autonomy.click();
  await page.getByRole('menuitemradio', { name: /^Review each step/ }).click();
  await expect(autonomy).toHaveText('Review each step');
  await page.keyboard.press('Escape');

  await linkedChat(page, repo);
  await expect(pickerButton(page)).toContainText('· Accept edits · Review each step');
  const panel = await openPermissions(page);
  await expect(
    panel
      .getByRole('radiogroup', { name: 'Harness autonomy' })
      .getByRole('radio', { name: 'Review each step', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
});
