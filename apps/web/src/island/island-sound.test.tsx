// @vitest-environment jsdom
import { StrictMode } from 'react';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { API_CHAT, FE_CHAT, DOCS_CHAT, chat } from '../outposts/test-fixtures.ts';
import type { Moment } from './island-model.ts';
import { momentChime, needsChime, useChimes, waitingChats } from './island-sound.ts';

const ON_SCREEN_KEY = 'spark-outpost.on-screen-chat';
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
  chats: readonly ConversationSummary[] | null;
  moment: Moment | null;
  focused: boolean;
}

const QUIET: Props = {
  on: true,
  chats: [chat(FE_CHAT), chat(API_CHAT)],
  moment: null,
  focused: false,
};

function chimes(first: Partial<Props> = {}, strict = false) {
  return renderHook(
    (props: Props) => useChimes(props.on, props.chats, props.moment, props.focused),
    { initialProps: { ...QUIET, ...first }, wrapper: strict ? StrictMode : undefined },
  );
}

function asking(...ids: string[]): ConversationSummary[] {
  return [FE_CHAT, API_CHAT, DOCS_CHAT].map((id) => chat(id, { needsInput: ids.includes(id) }));
}

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  tones.length = 0;
});

describe('chime decisions', () => {
  it('lists the chats that wait for the user, leaving archived ones out', () => {
    const archived = chat(DOCS_CHAT, { needsInput: true, archivedAt: '2026-10-09T10:00:00.000Z' });
    expect(waitingChats([chat(FE_CHAT, { needsInput: true }), chat(API_CHAT), archived])).toEqual([
      FE_CHAT,
    ]);
  });

  it('chimes for a chat that starts waiting unless it is the one being watched', () => {
    expect(needsChime(new Set(), [FE_CHAT], null)).toBe(true);
    expect(needsChime(new Set(), [FE_CHAT], FE_CHAT)).toBe(false);
    expect(needsChime(new Set(), [FE_CHAT, API_CHAT], FE_CHAT)).toBe(true);
    expect(needsChime(new Set([FE_CHAT]), [FE_CHAT], null)).toBe(false);
  });

  it('keeps a failure in the watched chat silent and always plays done', () => {
    const failed: Moment = { kind: 'failed', chatId: FE_CHAT, runId: RUN_A };
    expect(momentChime(failed, null)).toBe('failed');
    expect(momentChime(failed, API_CHAT)).toBe('failed');
    expect(momentChime(failed, FE_CHAT)).toBeNull();
    expect(momentChime({ ...failed, kind: 'done' }, FE_CHAT)).toBe('done');
  });
});

describe('useChimes', () => {
  it('plays the needs chime when a chat starts waiting', () => {
    const hook = chimes({ chats: asking() });
    hook.rerender({ ...QUIET, chats: asking(FE_CHAT) });
    expect(played()).toEqual(['needs']);
  });

  it('stays silent for chats already waiting when the island loads', () => {
    const hook = chimes({ chats: null });
    hook.rerender({ ...QUIET, chats: asking(FE_CHAT) });
    expect(played()).toEqual([]);
  });

  it('plays once when two chats start waiting together and not again on a refresh', () => {
    const hook = chimes({ chats: asking() });
    hook.rerender({ ...QUIET, chats: asking(FE_CHAT, API_CHAT) });
    hook.rerender({ ...QUIET, chats: asking(FE_CHAT, API_CHAT) });
    expect(played()).toEqual(['needs']);
  });

  it('plays when one chat stops waiting as another starts', () => {
    const hook = chimes({ chats: asking(FE_CHAT) });
    hook.rerender({ ...QUIET, chats: asking(API_CHAT) });
    expect(played()).toEqual(['needs']);
  });

  it('stays silent when Spark is focused on the chat that needs the user', () => {
    localStorage.setItem(ON_SCREEN_KEY, FE_CHAT);
    const hook = chimes({ chats: asking(), focused: true });
    hook.rerender({ ...QUIET, focused: true, chats: asking(FE_CHAT) });
    expect(played()).toEqual([]);
  });

  it('plays when Spark is focused on a different chat', () => {
    localStorage.setItem(ON_SCREEN_KEY, FE_CHAT);
    const hook = chimes({ chats: asking(), focused: true });
    hook.rerender({ ...QUIET, focused: true, chats: asking(API_CHAT) });
    expect(played()).toEqual(['needs']);
  });

  it('plays when the chat is on screen but Spark is not focused', () => {
    localStorage.setItem(ON_SCREEN_KEY, FE_CHAT);
    const hook = chimes({ chats: asking() });
    hook.rerender({ ...QUIET, chats: asking(FE_CHAT) });
    expect(played()).toEqual(['needs']);
  });

  it('plays a distinct chime when a run could not finish', () => {
    const hook = chimes();
    hook.rerender({ ...QUIET, moment: { kind: 'failed', chatId: FE_CHAT, runId: RUN_A } });
    expect(played()).toEqual(['failed']);
    expect(tones).toHaveLength(2);
  });

  it('keeps the failure chime quiet when Spark is focused on that chat', () => {
    localStorage.setItem(ON_SCREEN_KEY, FE_CHAT);
    const hook = chimes({ focused: true });
    hook.rerender({
      ...QUIET,
      focused: true,
      moment: { kind: 'failed', chatId: FE_CHAT, runId: RUN_A },
    });
    expect(played()).toEqual([]);
  });

  it('plays each finished run once across re-renders and under StrictMode', () => {
    const done: Moment = { kind: 'done', chatId: FE_CHAT, runId: RUN_A };
    const hook = chimes({ moment: done }, true);
    hook.rerender({ ...QUIET, moment: { ...done } });
    hook.rerender({ ...QUIET, moment: null });
    hook.rerender({ ...QUIET, moment: { kind: 'failed', chatId: API_CHAT, runId: RUN_B } });
    expect(played()).toEqual(['done', 'failed']);
  });

  it('plays nothing while chimes are off', () => {
    const hook = chimes({ on: false, chats: asking() });
    hook.rerender({
      ...QUIET,
      on: false,
      chats: asking(FE_CHAT),
      moment: { kind: 'failed', chatId: FE_CHAT, runId: RUN_A },
    });
    expect(played()).toEqual([]);
  });
});
