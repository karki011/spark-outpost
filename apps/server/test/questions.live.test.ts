import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formContent, formQuestions } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import type {
  AgentQuestion,
  ProviderOutput,
  ProviderTurn,
  QuestionGate,
} from '../src/providers/provider.ts';

const PROMPT =
  'Before you answer, use your tool for asking the user a multiple-choice question to ask me ' +
  'which colour I prefer, offering exactly two options: Teal and Amber. Then reply with only ' +
  'the colour I chose, in one word.';

const REPORT = process.env.SPARK_LIVE_REPORT ?? '';

function firstPicks(question: AgentQuestion) {
  return formQuestions(question.form).map((asked) => ({
    picks: asked.options.slice(0, 1),
    text: '',
  }));
}

function planningTurn(): Partial<ProviderTurn> {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'spark-live-questions-')));
  writeFileSync(join(folder, 'README.md'), '# Colours\n');
  return { projectRoots: [folder], mode: 'ask', planning: true };
}

async function ask(id: 'claude' | 'codex', extra: Partial<ProviderTurn> = {}) {
  const asked: AgentQuestion[] = [];
  const gate: QuestionGate = {
    async ask(question) {
      asked.push(question);
      const content = formContent(question.form, firstPicks(question));
      return content.ok ? { action: 'accept', content: content.value } : { action: 'decline' };
    },
  };
  const outputs: ProviderOutput[] = [];
  for await (const output of createAcpProvider({ definition: agentDefinitions[id] }).run({
    prompt: PROMPT,
    history: [],
    settings: { method: 'cli', model: null, modelLabel: null, effort: 'low' },
    signal: new AbortController().signal,
    questions: gate,
    ...extra,
  })) {
    outputs.push(output);
  }
  const text = outputs.map((output) => (output.kind === 'text_delta' ? output.delta : '')).join('');
  if (REPORT) writeFileSync(join(REPORT, `${id}.json`), JSON.stringify({ asked, text }, null, 1));
  return { asked, text };
}

describe('live agent questions over ACP elicitation', () => {
  it('Claude asks through AskUserQuestion and reads the answer back', async () => {
    const { asked, text } = await ask('claude');
    expect(asked).toHaveLength(1);
    const picked = formQuestions(asked[0]!.form)[0]!.options[0]!;
    expect(text.toLowerCase()).toContain(picked.toLowerCase());
  });

  it('Codex asks through request_user_input in a planning turn', async () => {
    const { asked, text } = await ask('codex', planningTurn());
    expect(asked).toHaveLength(1);
    const picked = formQuestions(asked[0]!.form)[0]!.options[0]!;
    expect(text.toLowerCase()).toContain(picked.toLowerCase());
  });
});
