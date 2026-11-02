import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import type {
  PermissionGate,
  ProviderOutput,
  ProviderTurn,
  StoredSession,
} from '../src/providers/provider.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { ENGINEERING } from '../src/workflow/chat-prompt-text.ts';
import { startFakeAnthropicApi } from './fake-anthropic-api.ts';

const base = mkdtempSync(join(tmpdir(), 'claude-file-tools-'));
const repo = join(base, 'repo');
const FILE_TOOLS = ['Read', 'Edit', 'Write'];
const CHANGE_LINE = ENGINEERING.split('\n')[1]!;

const gate: PermissionGate = {
  review: async (request) => {
    const option = request.options.find((candidate) => candidate.kind === 'allow_once')!;
    return { outcome: 'selected', optionId: option.optionId, allowed: true, note: 'allowed' };
  },
};

let api: Awaited<ReturnType<typeof startFakeAnthropicApi>>;
let provider: ReturnType<typeof createAcpProvider>;
let stored: StoredSession | null = null;

beforeAll(async () => {
  mkdirSync(repo);
  writeFileSync(join(repo, 'cart.js'), 'export const total = () => 0;\n');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  api = await startFakeAnthropicApi();
  const config = join(base, 'claude-config');
  mkdirSync(config);
  provider = createAcpProvider({
    definition: agentDefinitions.claude,
    cancelGraceMs: 2_000,
    env: {
      ...childEnvironment(process.env),
      ANTHROPIC_BASE_URL: api.url,
      ANTHROPIC_API_KEY: 'sk-ant-test-not-a-key',
      CLAUDE_CONFIG_DIR: config,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
  });
});

afterAll(async () => {
  await api?.close();
  rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

type Kind = Pick<ProviderTurn, 'mode' | 'planning' | 'plansFirst' | 'changesProject' | 'live'> & {
  agentMode: string;
};

async function turn(kind: Kind) {
  const before = api.requests.length;
  const outputs: ProviderOutput[] = [];
  const { agentMode, ...shape } = kind;
  for await (const output of provider.run({
    ...shape,
    prompt: 'Change total() in cart.js to add up item prices.',
    history: [],
    settings: { method: 'cli', model: 'opus', modelLabel: 'Opus', effort: null, mode: agentMode },
    projectRoots: [repo],
    signal: new AbortController().signal,
    approvals: gate,
    spark: { displayName: 'Alex', personality: 'friendly', chatPrompt: ENGINEERING },
    session: { workdir: join(base, 'work'), resume: stored, freshReason: null },
  })) {
    outputs.push(output);
    if (output.kind === 'session') {
      stored = {
        sessionId: output.sessionId,
        cwd: output.cwd,
        additionalDirectories: output.additionalDirectories,
      };
    }
  }
  const sent = api.requests.slice(before);
  expect(sent.length).toBeGreaterThan(0);
  const session = outputs.find((output) => output.kind === 'session');
  return { sent, continued: session?.kind === 'session' && session.continued };
}

const doing = (agentMode: string, live = false): Kind => ({
  mode: 'do',
  changesProject: true,
  agentMode,
  ...(live ? { live: { conversationId: 'chat-1' } } : {}),
});

describe.skipIf(spawnSync('claude', ['--version']).status !== 0)(
  'Claude file tools across the turns of one chat, against the real adapter',
  () => {
    it('sends Read, Edit and Write on do turns, fresh, live, resumed and in a Plan-mode chat, and never on Ask turns', async () => {
      const first = await turn(doing('acceptEdits', true));
      for (const request of first.sent) {
        expect(request.tools).toEqual(expect.arrayContaining(FILE_TOOLS));
        expect(request.system).toContain(CHANGE_LINE);
      }
      const live = await turn(doing('default', true));
      for (const request of live.sent) {
        expect(request.tools).toEqual(expect.arrayContaining(FILE_TOOLS));
      }
      const ask = await turn({
        mode: 'ask',
        agentMode: 'default',
        live: { conversationId: 'chat-1' },
      });
      for (const request of ask.sent) {
        expect(request.tools).not.toContain('Edit');
        expect(request.tools).not.toContain('Write');
      }
      const plan = await turn({ mode: 'ask', planning: true, agentMode: 'plan' });
      for (const request of plan.sent) {
        expect(request.tools).toEqual(expect.arrayContaining(['Read', 'Write', 'ExitPlanMode']));
        expect(request.tools).not.toContain('Edit');
      }
      const planChat = await turn({ ...doing('plan'), plansFirst: true });
      for (const request of planChat.sent) {
        expect(request.tools).toEqual(expect.arrayContaining([...FILE_TOOLS, 'ExitPlanMode']));
      }
      const approved = await turn(doing('acceptEdits'));
      for (const request of approved.sent) {
        expect(request.tools).toEqual(expect.arrayContaining(FILE_TOOLS));
        expect(request.system).toContain(CHANGE_LINE);
      }
      expect([first, live, ask, plan, planChat, approved].map((step) => step.continued)).toEqual([
        false,
        true,
        true,
        true,
        true,
        true,
      ]);
    }, 120_000);
  },
);
