import { describe, expect, it } from 'vitest';
import type { Command } from './commands.ts';
import {
  IDLE,
  nextPurpose,
  speechReducer,
  type SpeechAction,
  type SpeechState,
} from './speech-machine.ts';

const ask: Command = { intent: 'ask_fast', question: 'needs', ticket: null };

function run(actions: SpeechAction[], from: SpeechState = IDLE): SpeechState {
  return actions.reduce(speechReducer, from);
}

describe('speechReducer', () => {
  it('listens, works it out and shows the result', () => {
    const state = run([
      { type: 'start', purpose: 'command' },
      { type: 'started', id: 'a' },
      { type: 'speech', id: 'a' },
      { type: 'level', id: 'a', level: 0.4 },
      { type: 'stopping' },
    ]);
    expect(state.listen).toMatchObject({ phase: 'working', heard: true, level: 0.4 });
    const done = speechReducer(state, {
      type: 'heard',
      id: 'a',
      text: 'who needs me',
      command: ask,
    });
    expect(done.listen).toBeNull();
    expect(done.result).toEqual({ id: 1, transcript: 'who needs me', command: ask });
  });

  it('an empty transcript says it didn’t catch that and shows no result', () => {
    const state = run([
      { type: 'start', purpose: 'command' },
      { type: 'started', id: 'a' },
      { type: 'heard', id: 'a', text: '  ', command: null },
    ]);
    expect(state.notice).toBe('missed');
    expect(state.result).toBeNull();
  });

  it('Esc while listening drops it with no transcript and no result', () => {
    const state = run([
      { type: 'start', purpose: 'command' },
      { type: 'started', id: 'a' },
      { type: 'escape' },
      { type: 'heard', id: 'a', text: 'open the dashboards chat', command: ask },
    ]);
    expect(state).toEqual(IDLE);
  });

  it('ignores events from a listen that is not the current one', () => {
    const state = run([
      { type: 'start', purpose: 'command' },
      { type: 'started', id: 'b' },
      { type: 'heard', id: 'old', text: 'who needs me', command: ask },
      { type: 'failed', id: 'old', error: 'busy' },
    ]);
    expect(state.listen).toMatchObject({ id: 'b', phase: 'listening' });
    expect(state.notice).toBeNull();
  });

  it('a press while a result is open listens to confirm it, keeping the result', () => {
    const shown = run([
      { type: 'start', purpose: 'command' },
      { type: 'started', id: 'a' },
      { type: 'heard', id: 'a', text: 'who needs me', command: ask },
    ]);
    expect(nextPurpose(shown)).toBe('confirm');
    const confirmed = run(
      [
        { type: 'start', purpose: 'confirm' },
        { type: 'started', id: 'c' },
        { type: 'heard', id: 'c', text: 'send it', command: null },
      ],
      shown,
    );
    expect(confirmed.result?.id).toBe(1);
    expect(confirmed.listen).toBeNull();
  });

  it('a refused listen shows why', () => {
    expect(
      run([
        { type: 'start', purpose: 'command' },
        { type: 'refused', error: 'mic_denied' },
      ]),
    ).toMatchObject({
      listen: null,
      notice: 'mic_denied',
    });
  });

  it('Esc with a result open closes it', () => {
    const state = run([
      { type: 'start', purpose: 'command' },
      { type: 'started', id: 'a' },
      { type: 'heard', id: 'a', text: 'who needs me', command: ask },
      { type: 'escape' },
    ]);
    expect(state.result).toBeNull();
  });
});
