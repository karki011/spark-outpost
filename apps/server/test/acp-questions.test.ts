import { formContent } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import type {
  AgentQuestion,
  ProviderOutput,
  QuestionGate,
  QuestionReply,
} from '../src/providers/provider.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { FAKE_ACP_LAUNCH as launch, replyText } from './fake-acp-support.ts';

const agent = createAcpProvider({
  definition: { ...agentDefinitions.claude, name: 'Fake', ...FAKE_AGENT_MODES },
  launch,
  cancelGraceMs: 2_000,
});

interface Asked {
  question: AgentQuestion;
  signal: AbortSignal;
  agentCancel: AbortSignal;
}

type Answer = (asked: Asked) => Promise<QuestionReply>;

function gate(answer: Answer) {
  const asked: Asked[] = [];
  const stub: QuestionGate = {
    ask: (question, signal, agentCancel) => {
      const seen = { question, signal, agentCancel };
      asked.push(seen);
      return answer(seen);
    },
  };
  return { stub, asked };
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

function untilAborted(signal: AbortSignal): Promise<QuestionReply> {
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve({ action: 'cancel' }), { once: true });
  });
}

describe('ACP elicitation/create becomes a question card', { timeout: 20_000 }, () => {
  it('sends Claude’s AskUserQuestion form to the gate and the answers back to the tool', async () => {
    const { stub, asked } = gate(async ({ question }) => {
      const content = formContent(question.form, [
        { picks: ['Redis'], text: '' },
        { picks: ['Lint', 'Types'], text: 'e2e' },
      ]);
      if (!content.ok) throw new Error(content.error);
      return { action: 'accept', content: content.value };
    });
    const result = await run('Pick for me #askclaude', stub);
    expect(asked[0]?.question).toMatchObject({
      toolCallId: 'toolu_ask',
      agent: 'Fake',
      form: { message: 'Please answer the following questions.' },
    });
    expect(asked[0]?.question.form.fields.map((field) => [field.key, field.noteKey])).toEqual([
      ['question_0', 'question_0_custom'],
      ['question_1', 'question_1_custom'],
    ]);
    expect(result.text).toContain(
      'asked=accept answers={"Which store should the cache use?":"Redis","Which checks should run before the push?":"Lint, Types, e2e"}',
    );
  });

  it('answers decline when the user skips, so Claude hears the question was skipped', async () => {
    const { stub } = gate(async () => ({ action: 'decline' }));
    const result = await run('#askclaude', stub);
    expect(result.text).toContain('asked=decline answers={}');
  });

  it('sends a Codex answer as accept with the field content', async () => {
    const { stub, asked } = gate(async () => ({
      action: 'accept',
      content: { name: 'hot-cache' },
    }));
    const result = await run('#askcodex', stub);
    expect(asked[0]?.question.form.fields[0]).toMatchObject({ key: 'name', required: true });
    expect(result.text).toContain('asked={"action":"accept","content":{"name":"hot-cache"}}');
  });

  it('answers cancel when the turn is stopped while the card waits', async () => {
    const controller = new AbortController();
    const { stub, asked } = gate(({ signal }) => {
      setTimeout(() => controller.abort(), 50);
      return untilAborted(signal);
    });
    await run('#askcodex', stub, controller);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.signal.aborted).toBe(true);
  });

  it('tells the gate when the agent withdraws its own question', async () => {
    let turnStopped: boolean | null = null;
    const { stub, asked } = gate(({ agentCancel, signal }) => {
      agentCancel.addEventListener('abort', () => (turnStopped = signal.aborted), { once: true });
      return untilAborted(agentCancel);
    });
    const result = await run('#askwithdraw', stub);
    expect(asked[0]?.agentCancel.aborted).toBe(true);
    expect(turnStopped).toBe(false);
    expect(result.text).toMatch(/asked=(withdrawn|\{"action":"cancel"\})/);
  });

  it('cancels and says so when the run has no place to ask', async () => {
    const result = await run('#askcodex', null);
    expect(result.text).toContain('asked={"action":"cancel"}');
    expect(result.steps).toContain(
      "Fake asked a question this run can't show, so it was cancelled.",
    );
  });
});
