// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  VOICE_DEFAULT_SETTINGS,
  type VoiceModelId,
  type VoiceModelStatus,
  type VoiceStatus,
} from '@spark-outpost/contracts';
import { SpeechModels } from './SpeechModels.tsx';

const speech = vi.hoisted(() => ({
  select: vi.fn(async () => null),
  download: vi.fn(async () => null),
  cancelDownload: vi.fn(async () => null),
  remove: vi.fn(async () => null),
}));
vi.mock('../voice/speech-bridge.ts', () => ({ desktopSpeech: () => speech }));
beforeEach(() => Object.values(speech).forEach((mock) => mock.mockClear()));
afterEach(cleanup);

const missing: VoiceModelStatus = { state: 'missing', progress: null, problem: null };
const ready: VoiceModelStatus = { state: 'ready', progress: null, problem: null };

function status(
  models: Partial<Record<VoiceModelId, VoiceModelStatus>>,
  extra: { model?: VoiceModelId; language?: string } = {},
): VoiceStatus {
  return {
    supported: true,
    helper: 'ready',
    settings: { ...VOICE_DEFAULT_SETTINGS, enabled: true, model: extra.model ?? 'whisper-base' },
    mic: 'granted',
    inputMonitoring: false,
    fnSetting: 'emoji',
    fnActive: false,
    shortcutFailed: false,
    model: 'ready',
    models: {
      'parakeet-v3': missing,
      'whisper-base': ready,
      'whisper-large-v3-turbo': missing,
      ...models,
    },
    arch: 'arm64',
    language: extra.language ?? 'en',
  };
}

const show = (value: VoiceStatus) =>
  render(<SpeechModels status={value} onStatus={() => undefined} />);
const radio = (name: string) => screen.getByRole('radio', { name });
const row = (name: string) => radio(name).closest('.sm-row') as HTMLElement;

it('lists the three models with size and state, and what is on disk', () => {
  show(status({ 'parakeet-v3': ready }));
  expect(screen.getAllByRole('radio')).toHaveLength(3);
  expect(radio('Whisper base').getAttribute('aria-checked')).toBe('true');
  expect(within(row('Whisper base')).getByText('In use')).toBeTruthy();
  expect(within(row('Parakeet')).getByText('Downloaded')).toBeTruthy();
  expect(within(row('Parakeet')).getByText('549 MB')).toBeTruthy();
  expect(within(row('Whisper large v3 turbo')).getByText('Not downloaded')).toBeTruthy();
  expect(screen.getByText('609 MB on disk')).toBeTruthy();
  expect(screen.getByText(/Parakeet by NVIDIA, CC BY 4.0/)).toBeTruthy();
});

it('arrow keys move focus without choosing; Space or a click chooses', () => {
  show(status({}));
  const base = radio('Whisper base');
  expect(base.tabIndex).toBe(0);
  expect(radio('Parakeet').tabIndex).toBe(-1);
  base.focus();
  fireEvent.keyDown(base, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(radio('Whisper large v3 turbo'));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(radio('Parakeet'));
  expect(speech.select).not.toHaveBeenCalled();
  fireEvent.click(radio('Parakeet'));
  expect(speech.select).toHaveBeenCalledWith('parakeet-v3');
});

it('the model in use can’t be removed; another downloaded one can', () => {
  show(status({ 'parakeet-v3': ready }));
  const inUse = within(row('Whisper base')).getByRole('button', { name: 'Remove Whisper base' });
  expect((inUse as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(row('Parakeet')).getByRole('button', { name: 'Remove Parakeet' }));
  expect(speech.remove).toHaveBeenCalledWith('parakeet-v3');
});

it('a download shows its progress and can be cancelled; others wait', () => {
  show(status({ 'parakeet-v3': { state: 'downloading', progress: 0.42, problem: null } }));
  const parakeet = row('Parakeet');
  expect(within(parakeet).getByText('Downloading 42%')).toBeTruthy();
  expect(within(parakeet).getByRole('progressbar', { name: 'Parakeet download' })).toBeTruthy();
  fireEvent.click(within(parakeet).getByRole('button', { name: 'Cancel Parakeet download' }));
  expect(speech.cancelDownload).toHaveBeenCalledWith('parakeet-v3');
  const turbo = within(row('Whisper large v3 turbo')).getByRole('button', {
    name: 'Download Whisper large v3 turbo, 574 MB',
  });
  expect((turbo as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(radio('Whisper large v3 turbo'));
  expect(speech.select).not.toHaveBeenCalled();
});

it('shows a failed download’s reason and offers it again', () => {
  show(
    status({
      'whisper-large-v3-turbo': {
        state: 'failed',
        progress: null,
        problem: 'The download didn’t check out.',
      },
    }),
  );
  const turbo = row('Whisper large v3 turbo');
  expect(within(turbo).getByText('The download didn’t check out.')).toBeTruthy();
  fireEvent.click(within(turbo).getByRole('button', { name: /Download Whisper large/ }));
  expect(speech.download).toHaveBeenCalledWith('whisper-large-v3-turbo');
});

it('says when the model in use doesn’t understand the Mac’s language', () => {
  show(status({ 'parakeet-v3': ready }, { model: 'parakeet-v3', language: 'ja' }));
  expect(
    screen.getByText(/Parakeet doesn’t understand Japanese, your Mac’s language/),
  ).toBeTruthy();
  cleanup();
  show(status({}, { language: 'ja' }));
  expect(screen.queryByText(/your Mac’s language/)).toBeNull();
});
