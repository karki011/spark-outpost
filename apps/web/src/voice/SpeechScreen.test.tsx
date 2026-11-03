// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { liveWords, SpeechScreen } from './SpeechScreen.tsx';
import { IDLE, type Listen } from './speech-machine.ts';
import type { SpeechScreenModel } from './use-speech-island.ts';

afterEach(cleanup);

function model(listen: Partial<Listen>): SpeechScreenModel {
  return {
    state: {
      ...IDLE,
      listen: {
        phase: 'listening',
        id: 'a',
        purpose: 'command',
        level: 0.3,
        heard: true,
        partial: '',
        ...listen,
      },
    },
    shown: null,
    choices: [],
    selected: 0,
    onSelect: () => undefined,
    onConfirm: () => undefined,
    onStop: () => undefined,
    onOpenSettings: () => undefined,
    keepsPanel: false,
  };
}

it('shows the live words under Listening, kept out of the announcements', () => {
  render(<SpeechScreen screen={model({ partial: 'start a chat in orders' })} />);
  const state = screen.getByText('Listening… Esc to cancel');
  expect(state.getAttribute('aria-live')).toBe('polite');
  const live = screen.getByTestId('speech-live');
  expect(live.textContent).toBe('start a chat in orders');
  expect(live.getAttribute('aria-hidden')).toBe('true');
  expect(state.contains(live)).toBe(false);
});

it('keeps the live words while working it out, and shows none before speech', () => {
  const { rerender } = render(<SpeechScreen screen={model({ partial: '' })} />);
  expect(screen.queryByTestId('speech-live')).toBeNull();
  rerender(<SpeechScreen screen={model({ phase: 'working', partial: 'who needs me' })} />);
  expect(screen.getByText('Working it out…')).toBeTruthy();
  expect(screen.getByTestId('speech-live').textContent).toBe('who needs me');
});

it('shows the end of a long dictation, starting on a whole word', () => {
  const text = Array.from({ length: 60 }, (_, index) => `word${index}`).join(' ');
  const shown = liveWords(text);
  expect(shown.startsWith('…word')).toBe(true);
  expect(shown.endsWith('word59')).toBe(true);
  expect(shown.length).toBeLessThanOrEqual(141);
});
