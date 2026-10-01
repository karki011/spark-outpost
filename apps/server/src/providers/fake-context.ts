import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import type { ProviderOutput, ProviderTurn } from './provider.ts';

const CONTEXT_TRIGGER = /#ctx(\d{1,3})\b/;
const NO_COMPACT_TRIGGER = '#nocompact';
export const FAKE_CONTEXT_SIZE = 200_000;
const RESTING_PERCENT = 6;
const COMPACTED_PERCENT = 8;
export const FAKE_COMPACT_REPLY =
  'Compacted the conversation: kept the requests, decisions and open work.';

type Usage = Extract<ProviderOutput, { kind: 'usage' }>;

function chatTexts(turn: ProviderTurn): string[] {
  return [turn.prompt, turn.preamble ?? '', ...turn.history.map((entry) => entry.content)];
}

function tracksContext(turn: ProviderTurn): boolean {
  return turn.session !== undefined && chatTexts(turn).some((text) => CONTEXT_TRIGGER.test(text));
}

function usageAt(percent: number): Usage {
  const contextUsed = Math.round((FAKE_CONTEXT_SIZE * Math.min(100, percent)) / 100);
  return { kind: 'usage', contextUsed, contextSize: FAKE_CONTEXT_SIZE, costUsd: null };
}

export function fakeCompactTurn(turn: ProviderTurn): boolean {
  return turn.prompt.trim() === '/compact' && turn.session?.resume != null;
}

export function fakeSessionOutputs(turn: ProviderTurn): ProviderOutput[] {
  const target = turn.session;
  if (!target || !tracksContext(turn)) return [];
  const resume = target.resume;
  const outputs: ProviderOutput[] = [
    {
      kind: 'session',
      sessionId: resume?.sessionId ?? randomUUID(),
      cwd: resume?.cwd ?? turn.projectRoots?.[0] ?? target.workdir ?? tmpdir(),
      additionalDirectories: resume
        ? [...resume.additionalDirectories]
        : [...(turn.projectRoots ?? []).slice(1)],
      continued: resume !== null,
      freshReason: resume ? null : target.freshReason,
    },
  ];
  if (!chatTexts(turn).some((text) => text.includes(NO_COMPACT_TRIGGER))) {
    outputs.push({
      kind: 'commands',
      commands: [{ name: 'compact', description: 'Summarize the conversation so far', hint: null }],
    });
  }
  return outputs;
}

export function fakeCompactOutputs(): ProviderOutput[] {
  return [{ kind: 'text_delta', delta: FAKE_COMPACT_REPLY }, usageAt(COMPACTED_PERCENT)];
}

export function withFakeContext(turn: ProviderTurn, output: ProviderOutput): ProviderOutput {
  if (output.kind !== 'usage' || !tracksContext(turn)) return output;
  const asked = CONTEXT_TRIGGER.exec(turn.prompt)?.[1];
  return { ...usageAt(asked ? Number(asked) : RESTING_PERCENT), costUsd: output.costUsd };
}
