import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import type { ProviderOutput, ProviderTurn } from './provider.ts';

const CONTEXT_TRIGGER = /#ctx(\d{1,3})\b/;
const NO_COMPACT_TRIGGER = '#nocompact';
const LONG_WINDOW_TRIGGER = '#window1m';
const MID_TURN_TRIGGER = '#midturn';
const ADAPTER_DEFAULT_WINDOW = 200_000;
const LONG_WINDOW_MODEL = 'claude-opus-5-5';
export const FAKE_CONTEXT_SIZE = 200_000;
const FAKE_LONG_CONTEXT_SIZE = 1_000_000;
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

function windowOf(turn: ProviderTurn): number {
  const long = chatTexts(turn).some((text) => text.includes(LONG_WINDOW_TRIGGER));
  return long ? FAKE_LONG_CONTEXT_SIZE : FAKE_CONTEXT_SIZE;
}

function usageAt(percent: number, contextSize = FAKE_CONTEXT_SIZE): Usage {
  const contextUsed = Math.round((contextSize * Math.min(100, percent)) / 100);
  return { kind: 'usage', contextUsed, contextSize, costUsd: null };
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

export function fakeCompactOutputs(turn: ProviderTurn): ProviderOutput[] {
  return [
    { kind: 'text_delta', delta: FAKE_COMPACT_REPLY },
    usageAt(COMPACTED_PERCENT, windowOf(turn)),
  ];
}

export function fakeMidTurnUsage(turn: ProviderTurn): Usage[] {
  if (!tracksContext(turn) || !turn.prompt.includes(MID_TURN_TRIGGER)) return [];
  const window = windowOf(turn);
  const asked = Number(CONTEXT_TRIGGER.exec(turn.prompt)?.[1] ?? RESTING_PERCENT);
  const model = window === FAKE_LONG_CONTEXT_SIZE ? LONG_WINDOW_MODEL : turn.settings.model;
  return [
    {
      ...usageAt(asked, window),
      contextSize: ADAPTER_DEFAULT_WINDOW,
      provisionalWindow: true,
      ...(model ? { model } : {}),
    },
  ];
}

export function withFakeContext(turn: ProviderTurn, output: ProviderOutput): ProviderOutput {
  if (output.kind !== 'usage' || !tracksContext(turn)) return output;
  const asked = CONTEXT_TRIGGER.exec(turn.prompt)?.[1];
  const percent = asked ? Number(asked) : RESTING_PERCENT;
  return { ...usageAt(percent, windowOf(turn)), costUsd: output.costUsd };
}
