import { describe, expect, it } from 'vitest';
import type { ProviderOutput } from '../providers/provider.ts';
import { contextWindows, windowFor } from './context-window.ts';

type Usage = Extract<ProviderOutput, { kind: 'usage' }>;

const OPUS = 'claude-opus-5-5';
const ADAPTER_DEFAULT = 200_000;

function request(used: number, model: string | null = OPUS): Usage {
  return {
    kind: 'usage',
    contextUsed: used,
    contextSize: ADAPTER_DEFAULT,
    costUsd: null,
    provisionalWindow: true,
    ...(model ? { model } : {}),
  };
}

function result(used: number, size: number, model = OPUS): Usage {
  return { kind: 'usage', contextUsed: used, contextSize: size, costUsd: 0.81, model };
}

const percent = (usage: Usage) =>
  usage.contextSize ? Math.round((usage.contextUsed / usage.contextSize) * 100) : null;

describe('contextWindows', () => {
  it('shows the same share of an Opus 5.5 window during and after a turn', () => {
    const windows = contextWindows('claude', null);
    const during = windows.settle(request(134_000));
    const after = windows.settle(result(134_000, 1_000_000));
    expect(percent(during)).toBe(13);
    expect(percent(after)).toBe(13);
    expect(during).not.toHaveProperty('provisionalWindow');
  });

  it("keeps each request's own reading across a turn of several model requests", () => {
    const windows = contextWindows('claude', null);
    const readings = [120_000, 126_000, 134_000].map((used) => windows.settle(request(used)));
    expect(readings.map((usage) => usage.contextUsed)).toEqual([120_000, 126_000, 134_000]);
    expect(readings.map((usage) => usage.contextSize)).toEqual([1_000_000, 1_000_000, 1_000_000]);
  });

  it('keeps a smaller window the account reported for the same model', () => {
    const stored = { model: 'opus[1m]', size: 200_000 };
    expect(contextWindows('claude', stored).settle(request(150_000)).contextSize).toBe(200_000);

    const unnamed = { model: 'default', size: 200_000 };
    expect(contextWindows('claude', unnamed).settle(request(150_000)).contextSize).toBe(200_000);

    const windows = contextWindows('claude', null);
    windows.settle(result(150_000, 200_000));
    expect(windows.settle(request(160_000)).contextSize).toBe(200_000);
  });

  it("uses the new model's window after a model switch", () => {
    const stored = { model: OPUS, size: 1_000_000 };
    const windows = contextWindows('claude', stored);
    expect(windows.settle(request(40_000, 'claude-haiku-4-5')).contextSize).toBe(200_000);
    windows.settle(result(40_000, 200_000, 'claude-haiku-4-5'));
    expect(windows.settle(request(50_000, OPUS)).contextSize).toBe(1_000_000);
  });

  it('leaves the window unknown rather than guessing', () => {
    const windows = contextWindows('claude', null);
    expect(windows.settle(request(10_000, 'mystery-model')).contextSize).toBeNull();
    expect(windows.settle(request(10_000, null)).contextSize).toBeNull();
  });

  it('keeps the known window for a reading that names no model', () => {
    const windows = contextWindows('claude', { model: 'default', size: 1_000_000 });
    expect(windows.settle(request(20_000, null)).contextSize).toBe(1_000_000);
  });

  it('passes a reported window through unchanged, as Codex sends', () => {
    const windows = contextWindows('codex', null);
    const codex: Usage = {
      kind: 'usage',
      contextUsed: 52_000,
      contextSize: 258_400,
      costUsd: null,
    };
    expect(windows.settle(codex)).toEqual(codex);
  });
});

describe('windowFor', () => {
  it("reads a model's window from its card", () => {
    expect(windowFor('claude', 'claude-opus-5-5[1m]', null)).toBe(1_000_000);
    expect(windowFor('claude', 'claude-haiku-4-5', null)).toBe(200_000);
    expect(windowFor('zai', 'glm-5.3', null)).toBe(1_000_000);
  });
});
