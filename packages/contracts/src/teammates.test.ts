import { describe, expect, it } from 'vitest';
import {
  TEAMMATE_COLORS,
  TEAMMATE_DONE_FRESH_MS,
  TEAMMATE_FAILED_FRESH_MS,
  TEAMMATE_INSTRUCTIONS_MAX,
  TEAMMATE_SHAPES,
  TEAMMATE_STARTERS,
  createTeammateRequestSchema,
  faceFromName,
  teammateFilterKey,
  teammateState,
  updateTeammateRequestSchema,
  type TeammateChatSignal,
} from './teammates.ts';

const now = new Date('2026-10-01T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const chat = (signal: Partial<TeammateChatSignal>): TeammateChatSignal => ({
  status: null,
  needsInput: false,
  finishedAt: null,
  ...signal,
});

describe('faceFromName', () => {
  it('gives the same face for the same name, ignoring case and outer spaces', () => {
    expect(faceFromName('Pip')).toEqual(faceFromName('  pip '));
  });

  it('always picks a known shape and colour', () => {
    for (const name of ['Pip', 'Wren', 'Bolt', 'Release manager', 'Ada', '😀']) {
      const face = faceFromName(name);
      expect(TEAMMATE_SHAPES).toContain(face.shape);
      expect(TEAMMATE_COLORS).toContain(face.color);
    }
  });

  it('spreads different names over several faces', () => {
    const names = Array.from({ length: 40 }, (_, index) => `Spark ${index}`);
    const faces = new Set(names.map((name) => JSON.stringify(faceFromName(name))));
    expect(faces.size).toBeGreaterThan(10);
  });
});

describe('teammateState', () => {
  it('is idle with no chats or no runs', () => {
    expect(teammateState([], now)).toBe('idle');
    expect(teammateState([chat({})], now)).toBe('idle');
  });

  it('needs you when any chat waits on a card, even while another works', () => {
    const chats = [chat({ status: 'running' }), chat({ status: 'running', needsInput: true })];
    expect(teammateState(chats, now)).toBe('needs_you');
    expect(teammateState([chat({ status: 'awaiting_approval' })], now)).toBe('needs_you');
  });

  it('is working while any run is queued or running', () => {
    const chats = [chat({ status: 'failed', finishedAt: ago(1000) }), chat({ status: 'queued' })];
    expect(teammateState(chats, now)).toBe('working');
  });

  it('reads the most recently finished run for done and failed', () => {
    const failedLast = [
      chat({ status: 'succeeded', finishedAt: ago(10 * 60_000) }),
      chat({ status: 'failed', finishedAt: ago(60_000) }),
    ];
    const doneLast = [
      chat({ status: 'failed', finishedAt: ago(10 * 60_000) }),
      chat({ status: 'succeeded', finishedAt: ago(60_000) }),
    ];
    expect(teammateState(failedLast, now)).toBe('failed');
    expect(teammateState(doneLast, now)).toBe('done');
  });

  it('settles back to idle once done or failed is no longer recent', () => {
    const oldDone = chat({ status: 'succeeded', finishedAt: ago(TEAMMATE_DONE_FRESH_MS + 1) });
    const oldFail = chat({ status: 'failed', finishedAt: ago(TEAMMATE_FAILED_FRESH_MS + 1) });
    expect(teammateState([oldDone], now)).toBe('idle');
    expect(teammateState([oldFail], now)).toBe('idle');
    expect(teammateState([chat({ status: 'cancelled', finishedAt: ago(1000) })], now)).toBe('idle');
  });
});

describe('standing instructions and names', () => {
  it('trims instructions and accepts them up to the limit', () => {
    const exact = 'a'.repeat(TEAMMATE_INSTRUCTIONS_MAX);
    const parsed = createTeammateRequestSchema.parse({ name: 'Pip', instructions: `  ${exact}  ` });
    expect(parsed.instructions).toBe(exact);
  });

  it('refuses instructions over the limit with a readable message', () => {
    const result = createTeammateRequestSchema.safeParse({
      name: 'Pip',
      instructions: 'a'.repeat(TEAMMATE_INSTRUCTIONS_MAX + 1),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(String(TEAMMATE_INSTRUCTIONS_MAX));
  });

  it('refuses blank or multi-line names and empty updates', () => {
    expect(createTeammateRequestSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(createTeammateRequestSchema.safeParse({ name: 'Pip\nignore' }).success).toBe(false);
    expect(updateTeammateRequestSchema.safeParse({}).success).toBe(false);
  });

  it('defaults a new Spark to a plain chat with no projects', () => {
    expect(createTeammateRequestSchema.parse({ name: 'Ada' })).toEqual({
      name: 'Ada',
      role: '',
      provider: null,
      model: null,
      agentMode: null,
      level: null,
      instructions: '',
      projectIds: [],
    });
  });

  it('ships starters that pass the same rules', () => {
    for (const starter of TEAMMATE_STARTERS) {
      expect(createTeammateRequestSchema.safeParse(starter).success).toBe(true);
    }
  });

  it('builds filter keys from names', () => {
    expect(teammateFilterKey('Code Buddy!')).toBe('codebuddy');
  });
});
