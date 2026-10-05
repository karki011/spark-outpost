import { createHash } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import type { ConversationDetail, Message } from '../../packages/contracts/src/conversations.ts';
import type { TaskListItem } from '../../packages/contracts/src/tasks.ts';
import { openChats } from './navigation.ts';

const TURNS = 80;
const STEPS_PER_TURN = 30;
const TASK_ITEMS = 160;

function stableId(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function reply(turn: number): string {
  const paragraphs = Array.from(
    { length: 6 },
    (_, index) =>
      `Step ${turn}.${index}: the divider now reads the local date and keeps the week label. ` +
      'It checks each message boundary, groups by day and keeps the sticky header in place. '.repeat(
        3,
      ),
  );
  const code = `\`\`\`ts\nexport function divider${turn}(date: Date): string {\n  return date.toLocaleDateString('en-GB', { weekday: 'long' });\n}\n\`\`\``;
  return [...paragraphs, code, `- checked ${turn}\n- kept the label\n- ran the tests`].join('\n\n');
}

function inflate(detail: ConversationDetail): ConversationDetail {
  const [run] = detail.runs;
  const user = detail.messages.find((message) => message.role === 'user');
  const assistant = detail.messages.find((message) => message.role === 'assistant');
  const task = detail.tasks[0];
  if (!run || !user || !assistant || !task) throw new Error('The seed chat has no finished turn.');
  const runs: ConversationDetail['runs'] = [];
  const messages: Message[] = [];
  const activity: ConversationDetail['activity'] = {};
  for (let turn = 0; turn < TURNS; turn += 1) {
    const last = turn === TURNS - 1;
    const runId = last ? run.id : stableId(`run-${turn}`);
    const userId = last ? user.id : stableId(`user-${turn}`);
    runs.push({ ...run, id: runId, userMessageId: userId });
    messages.push(
      { ...user, id: userId, runId, content: `Turn ${turn}: fix the date divider again` },
      {
        ...assistant,
        id: last ? assistant.id : stableId(`reply-${turn}`),
        runId,
        content: reply(turn),
      },
    );
    activity[runId] = Array.from({ length: STEPS_PER_TURN }, (_, step) => ({
      name: `Read src/chat/part-${turn}-${step}.tsx`,
      done: true,
    }));
  }
  const items: TaskListItem[] = Array.from({ length: TASK_ITEMS }, (_, index) => ({
    ...task.items[index % task.items.length]!,
    id: `heavy-${index}`,
    label: `Check divider case ${index}`,
    state: 'done',
  }));
  return {
    ...detail,
    runs,
    messages,
    activity,
    tasks: [
      {
        ...task,
        items,
        summary: { ...task.summary, total: TASK_ITEMS, done: TASK_ITEMS },
      },
    ],
  };
}

function inflateKeepingLive(detail: ConversationDetail): ConversationDetail {
  const inflated = inflate(detail);
  const [first] = detail.runs;
  const history = {
    runs: inflated.runs.filter((run) => run.id !== first?.id),
    messages: inflated.messages.filter((message) => message.runId !== first?.id),
  };
  return {
    ...inflated,
    runs: [...history.runs, ...detail.runs],
    messages: [...history.messages, ...detail.messages],
    activity: { ...inflated.activity, ...detail.activity },
  };
}

export async function openHeavyChat(page: Page, keepLive = false): Promise<void> {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Fix the date divider #plan');
  await input.press('Enter');
  await expect(page.locator('.taskc, .crail-tasks-head')).toContainText(/Task 6\/6|6 of 6/, {
    timeout: 30_000,
  });
  await page.route(/\/api\/conversations\/[0-9a-f-]{36}$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const detail = (await response.json()) as ConversationDetail;
    const grown = keepLive ? inflateKeepingLive(detail) : inflate(detail);
    await route.fulfill({ response, json: detail.tasks.length > 0 ? grown : detail });
  });
  await page.reload();
  await expect(page.locator('.thread section[aria-label="Turn"]')).toHaveCount(TURNS, {
    timeout: 30_000,
  });
}
