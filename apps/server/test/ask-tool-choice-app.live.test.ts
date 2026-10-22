import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modeForLegacy } from '@spark-outpost/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { decideApproval } from '../src/persistence/approvals.ts';
import { getConversationDetail, sendUserMessage } from '../src/persistence/conversations.ts';
import { getRun, requestCancel } from '../src/persistence/runs.ts';
import { saveConnection } from '../src/persistence/setup.ts';
import { startSparkMcpHost } from '../src/spark-mcp/host.ts';
import { createProviders } from '../src/workflow/providers.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { linkedConversation } from './approval-support.ts';
import { toolDeps } from './spark-mcp-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import type * as PromptText from '../src/workflow/chat-prompt-text.ts';

vi.mock('../src/workflow/chat-prompt-text.ts', async (original) => {
  const actual = await original<typeof PromptText>();
  const line = process.env.ASK_LINE;
  return line === undefined
    ? actual
    : { ...actual, SPLIT_UNCLEAR: line, SPLIT_ASK_WITH_TOOL: line };
});

const RUNS = Number(process.env.ASK_RUNS ?? 3);
const AGENT = (process.env.ASK_AGENT ?? 'claude') as 'claude' | 'codex';
const LABEL = process.env.ASK_LABEL ?? 'current';
const REPORT = process.env.SPARK_LIVE_REPORT ?? '';
const TURN_MS = 180_000;

const PROMPTS: Record<string, string> = {
  askWhich:
    'Before changing anything, ask me which rounding approach I want for price.js and give me 3 options. Then wait for my answer.',
  letMePick: 'Give me a few options for how price.js should round, and let me pick one.',
  askMe: 'Ask me which currency format to show, then update price.js.',
  unclear: 'Make the prices nicer.',
  verbatim:
    'Before changing anything, ask me which rounding approach I want and give me 3 options. Then wait for my answer.',
};

const INSTRUCTIONS = process.env.ASK_REPO_INSTRUCTIONS;

let t: TestDb;
let worker: Worker;
let host: Awaited<ReturnType<typeof startSparkMcpHost>>;

beforeAll(async () => {
  t = await createTestDb();
  await saveConnection(t.db, t.workspaceId, AGENT, {
    method: 'cli',
    detail: 'live',
    summary: '',
    models: [],
  });
  host = await startSparkMcpHost(toolDeps(t));
  worker = startWorker({
    db: t.db,
    providers: createProviders('acp', undefined, undefined, host),
    leaseSeconds: 60,
    concurrency: 4,
    pollMs: 100,
    approvalPollMs: 200,
  });
});

afterAll(async () => {
  await worker.stop();
  await host.close();
  await t.cleanup();
});

function repo(): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'spark-ask-app-')));
  writeFileSync(join(folder, 'price.js'), 'export const price = (cents) => cents / 100;\n');
  if (INSTRUCTIONS) {
    writeFileSync(join(folder, 'AGENTS.md'), readFileSync(INSTRUCTIONS, 'utf8'));
    writeFileSync(join(folder, 'CLAUDE.md'), '@AGENTS.md\n');
  }
  execFileSync('git', ['init', '-q'], { cwd: folder });
  execFileSync('git', ['add', '.'], { cwd: folder });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base'], {
    cwd: folder,
  });
  return folder;
}

async function oneTurn(prompt: string): Promise<{ asked: boolean; status: string | null }> {
  const { conversationId } = await linkedConversation(t, repo());
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: prompt },
    {
      provider: AGENT,
      ...(AGENT === 'claude' ? { model: 'claude-opus-5-5' } : {}),
      permission: 'do',
      agentMode: modeForLegacy(AGENT, 'do', 'hands-off'),
      level: 'hands-off',
    },
  );
  let asked = false;
  const until = Date.now() + TURN_MS;
  while (Date.now() < until) {
    const detail = await getConversationDetail(t.db, conversationId);
    for (const approval of (detail?.approvals ?? []).filter((a) => a.status === 'pending')) {
      if (approval.payload.form) asked = true;
      const deny = approval.options.find((option) => option.kind.startsWith('reject'));
      await decideApproval(t.db, t.workspaceId, approval.id, {
        optionId: deny?.optionId ?? approval.options[0]!.optionId,
        scope: 'once',
      }).catch(() => undefined);
      if (asked) await requestCancel(t.db, sent.run.id);
    }
    const run = await getRun(t.db, sent.run.id);
    if (run?.finishedAt) return { asked, status: run.status };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await requestCancel(t.db, sent.run.id);
  return { asked, status: 'timeout' };
}

describe('how often the agent asks with its question tool in a Spark chat', () => {
  it('measures one wording on natural prompts', { timeout: 4 * 60 * 60 * 1000 }, async () => {
    const results: { label: string; prompt: string; asked: boolean; status: string | null }[] = [];
    for (let attempt = 0; attempt < RUNS; attempt += 1) {
      const batch = Object.entries(PROMPTS).map(async ([name, prompt]) => ({
        label: LABEL,
        prompt: name,
        ...(await oneTurn(prompt)),
      }));
      results.push(...(await Promise.all(batch)));
      if (REPORT) {
        writeFileSync(
          join(REPORT, `app-${AGENT}-${LABEL}${INSTRUCTIONS ? '-agentsmd' : ''}.json`),
          JSON.stringify(results, null, 1),
        );
      }
    }
    expect(results).toHaveLength(RUNS * Object.keys(PROMPTS).length);
  });
});
