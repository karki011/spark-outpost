import { describe, expect, it } from 'vitest';
import { MOD_BATCH_MAX, readModTelemetry } from './mod-telemetry.ts';

const request = {
  kind: 'request',
  prompt: 'prompt-1',
  agent: null,
  turn: 'turn-1',
  index: 0,
  model: 'claude-opus-5-5',
  input: 3,
  output: 40,
  cacheRead: 900,
  cacheWrite: 100,
  costUsd: 0.25,
};
const tool = {
  kind: 'tool',
  prompt: 'prompt-1',
  agent: 'agent-a',
  id: 'toolu_1',
  name: 'Bash',
  phase: 'start',
  failed: false,
  at: 1_792_000_000_000,
};

describe('turn facts from the Spark mod', () => {
  it('keeps the allowed facts', () => {
    expect(readModTelemetry({ items: [request, tool] })).toEqual([request, tool]);
  });

  it('drops an item that carries anything more, such as a command, a path, a reply or output', () => {
    const items = [
      { ...tool, command: 'git push origin main' },
      { ...tool, input: { file_path: '/Users/me/.env' } },
      { ...request, answer: 'Done.' },
      { ...tool, output: 'secret' },
      request,
    ];
    expect(readModTelemetry({ items })).toEqual([request]);
  });

  it('drops items with the wrong shape and refuses a batch that is not one', () => {
    const items = [
      { ...request, input: -1 },
      { ...request, model: 'x'.repeat(201) },
      { ...tool, phase: 'middle' },
      { kind: 'reply', prompt: 'p', agent: null },
      'text',
    ];
    expect(readModTelemetry({ items })).toEqual([]);
    expect(readModTelemetry({ items: [], extra: true })).toBeNull();
    expect(readModTelemetry([request])).toBeNull();
    expect(readModTelemetry({ items: Array(MOD_BATCH_MAX + 1).fill(tool) })).toBeNull();
  });
});
