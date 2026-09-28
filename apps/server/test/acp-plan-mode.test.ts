import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import type { ApprovalRequest } from '../src/approvals/decide.ts';
import type { GateAnswer, ProviderOutput } from '../src/providers/provider.ts';
import { FAKE_PLAN } from './fake-acp-plans.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';

const launch = {
  command: process.execPath,
  args: ['--import', import.meta.resolve('tsx'), join(import.meta.dirname, 'fake-acp-agent.ts')],
};
const claude = createAcpProvider({
  definition: { ...agentDefinitions.claude, name: 'Fake', ...FAKE_AGENT_MODES },
  launch,
  cancelGraceMs: 2_000,
});
let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-acp-plan-')));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function planTurn(pick: (request: ApprovalRequest) => GateAnswer) {
  const requests: ApprovalRequest[] = [];
  const outputs: ProviderOutput[] = [];
  let error: unknown = null;
  try {
    for await (const output of claude.run({
      prompt: 'Plan it first #planmode',
      history: [],
      settings: { method: 'cli', model: null, modelLabel: null, effort: null },
      projectRoots: [root],
      signal: new AbortController().signal,
      mode: 'do',
      approvals: {
        review: async (request) => {
          requests.push(request);
          return pick(request);
        },
      },
    })) {
      outputs.push(output);
    }
  } catch (caught) {
    error = caught;
  }
  const text = outputs.map((output) => (output.kind === 'text_delta' ? output.delta : '')).join('');
  return { requests, text, error };
}

describe("Claude's plan mode over ACP", () => {
  it('sends the plan to the gate with every option the agent offers, then keeps running', async () => {
    const { requests, text, error } = await planTurn((request) => ({
      outcome: 'selected',
      optionId: request.options.find((option) => option.optionId === 'exit-plan-default')!.optionId,
      allowed: true,
      note: 'Approved the plan',
    }));
    expect(error).toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      toolKind: 'switch_mode',
      plan: FAKE_PLAN,
      options: [
        { optionId: 'exit-plan-clear-auto', kind: 'allow_always' },
        { optionId: 'exit-plan-auto', kind: 'allow_always' },
        { optionId: 'exit-plan-default', kind: 'allow_once' },
        { optionId: 'reject', kind: 'reject_once' },
      ],
    });
    expect(text).toContain('Plan approved with exit-plan-default');
  });

  it('keeps planning when the plan is not approved', async () => {
    const { text, error } = await planTurn(() => ({
      outcome: 'selected',
      optionId: 'reject',
      allowed: false,
      note: 'Kept planning',
    }));
    expect(error).toBeNull();
    expect(text).toContain('Kept planning (reject)');
  });
});
