import { describe, expect, it } from 'vitest';
import type { ConversationSummary, NativeTerminalSession } from '@spark-outpost/contracts';
import {
  shownSession,
  terminalEnded,
  terminalLabel,
  terminalMood,
  terminalNeedsInput,
  terminalRelaunch,
} from './native-state.ts';
import { rowState, isRunning } from '../conversations/row-state.ts';
import { sessionState, pendingCards } from '../island/island-model.ts';

const terminal = (state: NativeTerminalSession['state']) => ({ state }) as NativeTerminalSession;
const chat = (state: NativeTerminalSession['state']) =>
  ({
    id: 'terminal-chat',
    sessionType: 'terminal',
    terminal: terminal(state),
    archivedAt: null,
    needsInput: false,
    updatedAt: '2026-10-08T10:00:00Z',
    latestRun: null,
  }) as ConversationSummary;

describe('native terminal activity across surfaces', () => {
  it('keeps unknown activity separate from ready and working', () => {
    expect(terminalLabel('unknown')).toBe('Open');
    expect(terminalLabel('ready')).toBe('Idle');
    expect(isRunning(chat('unknown'))).toBe(false);
    expect(isRunning(chat('working'))).toBe(true);
    expect(rowState(chat('unknown'), false).sub).toBe('Open');
  });
  it('routes native questions to an open-terminal Island card without loading an approval', () => {
    const waiting = chat('waiting_for_input');
    expect(terminalNeedsInput(waiting)).toBe(true);
    expect(sessionState(waiting)).toBe('waiting');
    expect(pendingCards([waiting], new Map(), new Set())).toEqual([
      { kind: 'open', chat: waiting, approval: null, loading: false },
    ]);
    expect(rowState(chat('waiting_for_permission'), false).tone).toBe('permission');
  });
  it('requires explicit recovery after exit or interruption', () => {
    for (const state of ['interrupted', 'error', 'exited'] as const)
      expect(terminalEnded(terminal(state))).toBe(true);
    expect(terminalEnded(terminal('ready'))).toBe(false);
    expect(terminalMood('interrupted')).toBe('failed');
  });
  it('offers resume for any ended session with a provider session, and start again otherwise', () => {
    const ended = (state: NativeTerminalSession['state'], resumeAvailable: boolean) =>
      ({ state, resumeAvailable }) as NativeTerminalSession;
    for (const state of ['exited', 'error', 'interrupted'] as const) {
      expect(terminalRelaunch(ended(state, true), 'outcome_unknown')).toBe('resume');
      expect(terminalRelaunch(ended(state, false), 'outcome_unknown')).toBe('restart');
      expect(terminalRelaunch(ended(state, false), 'failed')).toBe('restart');
    }
    expect(terminalRelaunch(ended('exited', false), 'cancelled')).toBeNull();
    expect(terminalRelaunch(ended('exited', true), 'cancelled')).toBe('resume');
    expect(terminalRelaunch(ended('working', true), 'running')).toBeNull();
    expect(terminalRelaunch(ended('unknown', false), null)).toBeNull();
  });
});

describe('shownSession', () => {
  it('shows a session that just exited here as exited before the server says so', () => {
    expect(shownSession(terminal('ready'), true).state).toBe('exited');
    expect(shownSession(terminal('ready'), false).state).toBe('ready');
  });

  it('keeps the state the server gives an ended session', () => {
    expect(shownSession(terminal('error'), true).state).toBe('error');
  });
});
