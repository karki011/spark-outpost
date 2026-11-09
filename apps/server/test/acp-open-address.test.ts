import { describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import type {
  AddressAsk,
  AddressReply,
  ProviderOutput,
  QuestionGate,
} from '../src/providers/provider.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';
import { OAUTH_URL } from './fake-acp-questions.ts';

const agent = createAcpProvider({
  definition: { ...agentDefinitions.claude, name: 'Fake', ...FAKE_AGENT_MODES },
  launch,
  cancelGraceMs: 2_000,
});

interface Opened {
  ask: AddressAsk;
  signal: AbortSignal;
  agentCancel: AbortSignal;
}

type Answer = (opened: Opened) => Promise<AddressReply>;

function gate(answer: Answer) {
  const opened: Opened[] = [];
  const stub: QuestionGate = {
    ask: async () => ({ action: 'cancel' }),
    open: (ask, signal, agentCancel) => {
      const seen = { ask, signal, agentCancel };
      opened.push(seen);
      return answer(seen);
    },
  };
  return { stub, opened };
}

async function run(
  prompt: string,
  questions: QuestionGate | null,
  controller = new AbortController(),
) {
  const outputs: ProviderOutput[] = [];
  for await (const output of agent.run({
    prompt,
    history: [],
    settings: { method: 'cli', model: null, modelLabel: null, effort: null },
    projectRoots: [],
    signal: controller.signal,
    ...(questions ? { questions } : {}),
  })) {
    outputs.push(output);
  }
  const steps = outputs.flatMap((output) => (output.kind === 'step_started' ? [output.name] : []));
  return { text: replyText(outputs), steps };
}

function untilAborted(signal: AbortSignal): Promise<AddressReply> {
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve('cancel'), { once: true });
  });
}

describe('ACP url elicitation becomes an Open this address card', { timeout: 20_000 }, () => {
  it('shows the address and its message, and answers accept once the user opens it', async () => {
    const { stub, opened } = gate(async () => 'accept');
    const result = await run('Sign in #openurl', stub);
    expect(opened[0]?.ask).toMatchObject({
      agent: 'Fake',
      url: OAUTH_URL,
      message: 'Authenticate with MCP server docs',
      secretFiles: [],
    });
    expect(result.text).toContain('opened=accept');
  });

  it('answers decline when the user chooses Don’t', async () => {
    const { stub } = gate(async () => 'decline');
    const result = await run('#openurl', stub);
    expect(result.text).toContain('opened=decline');
  });

  it('refuses an address on this computer before any card and says why', async () => {
    const { stub, opened } = gate(async () => 'accept');
    const result = await run('#openlocal', stub);
    expect(opened).toHaveLength(0);
    expect(result.text).toContain('opened=decline');
    expect(result.steps).toContain(
      "Spark didn't open an address Fake asked for: Spark does not open addresses on this computer for agents.",
    );
  });

  it('answers cancel when the turn is stopped while the card waits', async () => {
    const controller = new AbortController();
    const { stub, opened } = gate(({ signal }) => {
      setTimeout(() => controller.abort(), 50);
      return untilAborted(signal);
    });
    await run('#openurl', stub, controller);
    expect(opened).toHaveLength(1);
    expect(opened[0]?.signal.aborted).toBe(true);
  });

  it('closes the card when the agent says that elicitation is complete, ignoring other ids', async () => {
    let turnStopped: boolean | null = null;
    const { stub, opened } = gate(({ agentCancel, signal }) => {
      agentCancel.addEventListener('abort', () => (turnStopped = signal.aborted), { once: true });
      return untilAborted(agentCancel);
    });
    const result = await run('#opencomplete', stub);
    expect(opened[0]?.agentCancel.aborted).toBe(true);
    expect(turnStopped).toBe(false);
    expect(result.text).toContain('opened=cancel');
  });

  it('closes a card still waiting when the turn ends without it', async () => {
    const { stub, opened } = gate(({ signal }) => untilAborted(signal));
    await run('#openlater', stub);
    await expect.poll(() => opened[0]?.signal.aborted).toBe(true);
  });

  it('skips and says so when the run has no place to ask', async () => {
    const result = await run('#openurl', null);
    expect(result.text).toContain('opened=decline');
    expect(result.steps).toContain(
      "Fake asked to open an address this run can't show, so it was skipped.",
    );
  });
});
