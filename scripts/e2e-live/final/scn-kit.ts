import {
  allow,
  answerCards,
  connect,
  Log,
  makeRepo,
  openChat,
  post,
  rows,
  running,
  sampleMemory,
  sleep,
  waitIdle,
  waitUntil,
  type Chat,
} from './lib.ts';

const [scenario = '', arm = 'claude-auto', tag = ''] = process.argv.slice(2);
export const scenarioName = scenario;
export const label = `${scenario}-${arm}${tag ? `-${tag}` : ''}`;
export const ctx = connect();
export const log = new Log(label);

async function mapStatus(chat: Chat): Promise<unknown> {
  return rows(ctx, 'SELECT status, phase FROM map_repos WHERE root_path = $1', [chat.repo]).catch(
    (error: Error) => error.message,
  );
}

export async function turn(chat: Chat, text: string, timeoutMs?: number): Promise<string> {
  log.mark('map', await mapStatus(chat));
  const runId = await post(ctx, chat, text);
  log.mark(`sent ${runId}`, text.slice(0, 80));
  let sampled = 0;
  await waitIdle(ctx, chat, log, timeoutMs, async () => {
    const live = await running(ctx, chat);
    if (live.length > sampled) {
      sampled = live.length;
      await sleep(4_000);
      sampleMemory(
        ctx,
        log,
        `${live.length} child runs (${live.map((run) => run.role).join(',')})`,
      );
    }
  });
  log.mark(`idle after ${runId}`);
  sampleMemory(ctx, log, 'idle after turn');
  return runId;
}

export async function chatFor(files: Record<string, string>, level?: string): Promise<Chat> {
  const repo = makeRepo(label, files);
  const chat = await openChat(ctx, label, repo, arm, level);
  log.mark('chat', chat);
  return chat;
}

export async function builders(
  chat: Chat,
  atLeast: number,
  timeoutMs = 6 * 60_000,
): Promise<boolean> {
  return waitUntil(
    `${atLeast} builders running`,
    async () => {
      await answerCards(ctx, chat, log);
      return (await running(ctx, chat, 'builder')).length >= atLeast;
    },
    timeoutMs,
  );
}

export async function memberStates(chat: Chat): Promise<unknown> {
  return rows(
    ctx,
    'SELECT id, body, urgency, status, delivered_run_id, message_id FROM member_messages WHERE conversation_id = $1 ORDER BY created_at',
    [chat.conversationId],
  );
}

export async function planCard(chat: Chat, want: RegExp): Promise<void> {
  let held = 0;
  let answered = false;
  await waitIdle(
    ctx,
    chat,
    log,
    15 * 60_000,
    async () => {
      if (answered) return;
      const pending = await ctx.api.pending(chat.conversationId);
      const plan = pending.find((approval) => /plan/i.test(approval.title));
      if (!plan) return;
      if (held === 0) {
        held = Date.now();
        log.mark(`plan card held: ${plan.kind} "${plan.title}"`, {
          options: plan.options,
          reason: plan.reason,
          keys: Object.keys(plan),
        });
        return;
      }
      if (Date.now() - held < 12_000) return;
      const option =
        plan.options.find((candidate) => want.test(`${candidate.kind} ${candidate.name}`)) ??
        plan.options[0]!;
      answered = true;
      log.mark(`plan card answered with ${option.kind}:${option.name}`);
      await allow(ctx, plan, option.optionId);
    },
    (title) => /plan/i.test(title),
  );
}

export type Scenarios = Record<string, () => Promise<Chat>>;
