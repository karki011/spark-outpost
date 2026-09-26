import { expect, test, type Page } from '@playwright/test';
import { fakeReply } from '../../apps/server/src/providers/fake.ts';
import { resetTestDatabase } from './database.ts';

const MAX_FRAME_GROWTH = 200;

interface Sample {
  gap: number;
  top: number;
  length: number;
  sameMessage: boolean;
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

function longPrompt(): string {
  const paragraphs = Array.from(
    { length: 8 },
    (_, index) =>
      `Paragraph ${index + 1}: ` + 'streaming words keep arriving one after another '.repeat(6),
  );
  return [...paragraphs, '```ts\nconst answer = 42;\nconsole.log(answer);\n```', 'The end.'].join(
    '\n\n',
  );
}

async function startSampling(page: Page) {
  await page.evaluate(() => {
    const samples: Sample[] = [];
    const scope = window as unknown as { streamSamples: Sample[] };
    scope.streamSamples = samples;
    const firstMessage = document.querySelector('.msg.ai');
    const sample = () => {
      const thread = document.querySelector('.thread')!;
      const message = document.querySelector('.msg.ai');
      samples.push({
        gap: thread.scrollHeight - thread.scrollTop - thread.clientHeight,
        top: thread.scrollTop,
        length: message?.querySelector('.md')?.textContent?.length ?? 0,
        sameMessage: message === firstMessage,
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function takeSamples(page: Page): Promise<Sample[]> {
  return page.evaluate(() => {
    const scope = window as unknown as { streamSamples: Sample[] };
    return scope.streamSamples.splice(0);
  });
}

async function scrollState(page: Page) {
  return page.locator('.thread').evaluate((thread) => ({
    top: thread.scrollTop,
    height: thread.scrollHeight,
    gap: thread.scrollHeight - thread.scrollTop - thread.clientHeight,
  }));
}

function detailResponse(page: Page, conversationPath: string, timeout?: number) {
  return page.waitForResponse(
    (response) =>
      response.url().endsWith(conversationPath) && response.request().method() === 'GET',
    timeout ? { timeout } : undefined,
  );
}

async function refetchWithFinalText(page: Page, conversationPath: string, finalText: string) {
  let pending = true;
  await page.route(`**${conversationPath}`, async (route) => {
    if (!pending || route.request().method() !== 'GET') return route.fallback();
    pending = false;
    const response = await route.fetch();
    const detail = await response.json();
    const run = detail.runs.at(-1);
    run.status = 'succeeded';
    run.finishedAt = new Date().toISOString();
    detail.messages.push({
      id: crypto.randomUUID(),
      conversationId: detail.conversation.id,
      role: 'assistant',
      content: finalText,
      runId: run.id,
      createdAt: new Date().toISOString(),
      attachments: [],
    });
    await route.fulfill({ response, json: detail });
  });
  const refetched = detailResponse(page, conversationPath);
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await refetched;
}

function expectSteadyGrowth(samples: readonly Sample[]) {
  for (let index = 1; index < samples.length; index += 1) {
    const growth = samples[index]!.length - samples[index - 1]!.length;
    expect(growth).toBeGreaterThanOrEqual(0);
    expect(growth).toBeLessThanOrEqual(MAX_FRAME_GROWTH);
  }
}

test('a streaming reply follows the bottom, yields to the reader, and settles in place', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const prompt = longPrompt();
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat' }).first().click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(prompt);
  const sent = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/messages'),
  );
  await input.press('Enter');
  const conversationPath = new URL((await sent).url()).pathname.replace(/\/messages$/, '');

  const jump = page.getByRole('button', { name: 'Jump to latest' });
  const reply = page.locator('.msg.ai .md');
  await expect(reply).toContainText('Paragraph 1', { timeout: 15_000 });
  await startSampling(page);

  await page.waitForTimeout(2_000);
  const pinned = await takeSamples(page);
  expect(pinned.length).toBeGreaterThan(10);
  expect(pinned.at(-1)!.length).toBeGreaterThan(pinned[0]!.length);
  expect(Math.max(...pinned.map((sample) => sample.gap))).toBeLessThanOrEqual(80);
  await expect(jump).toBeHidden();

  await page.waitForTimeout(5_500);
  await refetchWithFinalText(page, conversationPath, fakeReply(prompt));
  await page.waitForTimeout(800);
  const afterRefetch = await takeSamples(page);
  expect(afterRefetch.every((sample) => sample.sameMessage)).toBe(true);
  expect(afterRefetch.at(-1)!.length).toBeGreaterThan(afterRefetch[0]!.length);
  await expect(reply).not.toContainText('The end.');

  await page.locator('.thread').hover();
  await page.mouse.wheel(0, -500);
  await expect(jump).toBeVisible();
  await page.waitForTimeout(300);
  const held = await scrollState(page);
  await page.waitForTimeout(1_500);
  const later = await scrollState(page);
  expect(later.height).toBeGreaterThan(held.height);
  expect(Math.abs(later.top - held.top)).toBeLessThanOrEqual(2);

  await jump.click();
  await expect.poll(async () => (await scrollState(page)).gap).toBeLessThanOrEqual(2);
  await expect(jump).toBeHidden();

  const finalRefetch = detailResponse(page, conversationPath, 45_000);
  await expect(reply).toContainText('The end.', { timeout: 45_000 });
  await finalRefetch;
  await expect(page.locator('.mood', { hasText: 'done' })).toBeVisible();
  await page.waitForTimeout(500);
  const settled = await takeSamples(page);
  const final = settled.at(-1)!;
  const lastStreamed = settled.findLast((sample) => sample.length < final.length);
  expect(settled.every((sample) => sample.sameMessage)).toBe(true);
  expect(final.gap).toBeLessThanOrEqual(2);
  if (lastStreamed) expect(Math.abs(final.top - lastStreamed.top)).toBeLessThanOrEqual(120);
  expectSteadyGrowth([...pinned, ...afterRefetch, ...settled]);
  await expect(reply.locator('.md-pre span[style]').first()).toBeVisible();
});
