import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { runSql, SEED_TITLE, seedTrackedPulls } from './pr-tracking-seed.ts';

const PULL = 'https://github.com/acme/widgets/pull/2818';
const NOTE =
  "This chat works on @alice's pull request #2818, branch CP-51843. Earlier work in this chat stays on spark/tidy-1a2b.";

function workspace(projectId: string, adopted: boolean) {
  return {
    place: 'worktree',
    requestedBranch: null,
    projectId,
    current: {
      projectId,
      branch: adopted ? 'CP-51843' : 'spark/tidy-1a2b',
      path: '/tmp/widgets/.spark/worktrees/chat',
      worktree: true,
      owned: true,
      baseBranch: 'main',
      baseRef: null,
      createdAt: null,
      adopted: adopted
        ? { number: 2818, author: 'alice', url: PULL, head: 'CP-51843', pushes: true }
        : null,
    },
  };
}

async function stubWorkspace(page: Page) {
  const projectId = randomUUID();
  const posts: unknown[] = [];
  let adopted = false;
  await page.route(/\/api\/conversations\/[^/]+\/workspace$/, (route) =>
    route.fulfill({ json: workspace(projectId, adopted) }),
  );
  await page.route(/\/api\/conversations\/[^/]+\/workspace\/adopt$/, (route) => {
    posts.push(route.request().postDataJSON());
    adopted = true;
    return route.fulfill({ json: { workspace: workspace(projectId, true), note: NOTE } });
  });
  return { projectId, posts };
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('a pull request the agent only mentioned can be worked on in this chat', async ({ page }) => {
  const { conversationId } = await seedTrackedPulls([]);
  await runSql(
    `INSERT INTO task_links (id, task_id, kind, url, title, source)
     SELECT $1, id, 'pr', $2, 'AI quotas sidebar', 'agent_text' FROM tasks WHERE conversation_id = $3`,
    [randomUUID(), PULL, conversationId],
  );
  const server = await stubWorkspace(page);
  await openChats(page);
  await expect(page.locator('.chat-title')).toHaveText(SEED_TITLE);
  const panel = page.locator('#work-panel');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show work panel' }).click();
  }
  await panel.getByRole('tab', { name: 'Links' }).click();
  await expect(panel).toContainText('Mentioned by the agent');

  const work = panel.getByRole('button', { name: 'Work on pull request #2818 in this chat' });
  await work.focus();
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('status')).toContainText('Earlier work in this chat stays on');
  expect(server.posts).toEqual([{ projectId: server.projectId, number: 2818, url: PULL }]);
  await expect(work).toHaveCount(0);
});

test('the Work panel offers a pull request to a chat that already has its own branch', async ({
  page,
}) => {
  await seedTrackedPulls([]);
  await stubWorkspace(page);
  await openChats(page);
  const panel = page.locator('#work-panel');
  const show = page.getByRole('button', { name: 'Show work panel' });
  await expect(panel.or(show).first()).toBeVisible();
  if (await show.isVisible()) await show.click();
  await panel.getByRole('button', { name: 'Work on a pull request…' }).click();
  await expect(panel).toContainText(
    'This chat switches to its branch; earlier work stays on spark/tidy-1a2b.',
  );
});
