// @vitest-environment jsdom
import { StrictMode } from 'react';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_CHAT, FE_CHAT } from '../outposts/test-fixtures.ts';
import type { Moment } from './island-model.ts';
import { alertChime, useChimes, type Alert } from './island-sound.ts';

const NONE: ReadonlySet<string> = new Set();
const OWN_NOTE = { needs: 880, done: 523.25, failed: 392 };
const RUN_A = '0e000000-0000-4000-8000-000000000001';
const RUN_B = '0e000000-0000-4000-8000-000000000002';

const tones: number[] = [];

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  createOscillator() {
    const frequency = { value: 0 };
    return {
      type: 'sine',
      frequency,
      connect: (node: unknown) => node,
      start: () => tones.push(frequency.value),
      stop: () => undefined,
    };
  }
  createGain() {
    const node = {
      gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
      connect: (next: unknown) => next,
    };
    return node;
  }
}

function played(): string[] {
  const names = Object.entries(OWN_NOTE);
  return tones.flatMap((tone) => names.filter(([, own]) => own === tone).map(([name]) => name));
}

interface Props {
  on: boolean;
  alerts: readonly Alert[] | null;
  moment: Moment | null;
  viewed: ReadonlySet<string>;
}

const QUIET: Props = { on: true, alerts: [], moment: null, viewed: NONE };

function chimes(first: Partial<Props> = {}, strict = false) {
  return renderHook(
    (props: Props) => useChimes(props.on, props.alerts, props.moment, props.viewed),
    { initialProps: { ...QUIET, ...first }, wrapper: strict ? StrictMode : undefined },
  );
}

function asking(...ids: string[]): Alert[] {
  return ids.map((chatId) => ({ key: `approval:${chatId}`, chatId }));
}

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  tones.length = 0;
});

describe('alertChime', () => {
  it('chimes for a new unread request unless the user is viewing its chat', () => {
    expect(alertChime(new Set(), asking(FE_CHAT), NONE)).toBe(true);
    expect(alertChime(new Set(), asking(FE_CHAT), new Set([FE_CHAT]))).toBe(false);
    expect(alertChime(new Set(), asking(FE_CHAT, API_CHAT), new Set([FE_CHAT]))).toBe(true);
    expect(alertChime(new Set([`approval:${FE_CHAT}`]), asking(FE_CHAT), NONE)).toBe(false);
  });
});

describe('useChimes', () => {
  it('plays the needs chime when a request arrives', () => {
    const hook = chimes();
    hook.rerender({ ...QUIET, alerts: asking(FE_CHAT) });
    expect(played()).toEqual(['needs']);
  });

  it('stays silent for requests already waiting when the island loads', () => {
    const hook = chimes({ alerts: null });
    hook.rerender({ ...QUIET, alerts: asking(FE_CHAT) });
    expect(played()).toEqual([]);
  });

  it('plays once when two requests arrive together and not again on a refresh', () => {
    const hook = chimes();
    hook.rerender({ ...QUIET, alerts: asking(FE_CHAT, API_CHAT) });
    hook.rerender({ ...QUIET, alerts: asking(FE_CHAT, API_CHAT) });
    expect(played()).toEqual(['needs']);
  });

  it('stays silent once a request is read anywhere, and for the chat being viewed', () => {
    const viewed = new Set([FE_CHAT]);
    const hook = chimes({ viewed });
    hook.rerender({ ...QUIET, viewed, alerts: asking(FE_CHAT) });
    hook.rerender({ ...QUIET, alerts: [] });
    hook.rerender({ ...QUIET, alerts: [] });
    expect(played()).toEqual([]);
  });

  it('never chimes for a finished or failed run, which is an update', () => {
    const hook = chimes({}, true);
    hook.rerender({ ...QUIET, moment: { kind: 'failed', chatId: FE_CHAT, runId: RUN_A } });
    hook.rerender({ ...QUIET, moment: { kind: 'done', chatId: API_CHAT, runId: RUN_B } });
    expect(played()).toEqual([]);
  });

  it('plays nothing while chimes are off', () => {
    const hook = chimes({ on: false });
    hook.rerender({ ...QUIET, on: false, alerts: asking(FE_CHAT) });
    expect(played()).toEqual([]);
  });

  it('holds chimes and counts finished runs during a calendar hold, and plays again after', () => {
    const held: string[] = [];
    const hold = { held: true, onHeld: (chime: string) => held.push(chime) };
    const hook = renderHook(
      (props: Props & { held: boolean }) =>
        useChimes(props.on, props.alerts, props.moment, props.viewed, {
          ...hold,
          held: props.held,
        }),
      { initialProps: { ...QUIET, on: false, held: true } },
    );
    hook.rerender({
      ...QUIET,
      on: false,
      alerts: asking(FE_CHAT),
      moment: { kind: 'done', chatId: API_CHAT, runId: RUN_A },
      held: true,
    });
    expect(played()).toEqual([]);
    expect(held.toSorted()).toEqual(['done', 'needs']);
    hook.rerender({ ...QUIET, alerts: asking(FE_CHAT, API_CHAT), moment: null, held: false });
    expect(played()).toEqual(['needs']);
  });
});
