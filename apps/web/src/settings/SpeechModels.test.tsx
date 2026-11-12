// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  VOICE_DEFAULT_SETTINGS,
  type VoiceModelStatus,
  type VoiceStatus,
} from '@spark-outpost/contracts';
import { SpeechModels } from './SpeechModels.tsx';

const speech = vi.hoisted(() => ({
  download: vi.fn(async () => null),
  cancelDownload: vi.fn(async () => null),
}));
vi.mock('../voice/speech-bridge.ts', () => ({ desktopSpeech: () => speech }));
beforeEach(() => Object.values(speech).forEach((mock) => mock.mockClear()));
afterEach(cleanup);

const missing: VoiceModelStatus = { state: 'missing', progress: null, problem: null };
const ready: VoiceModelStatus = { state: 'ready', progress: null, problem: null };

function status(parakeet: VoiceModelStatus, language = 'en'): VoiceStatus {
  return {
    supported: true,
    helper: 'ready',
    settings: { ...VOICE_DEFAULT_SETTINGS, enabled: true },
    mic: 'granted',
    inputMonitoring: false,
    fnSetting: 'emoji',
    fnActive: false,
    shortcutFailed: false,
    model: parakeet.state,
    models: { 'parakeet-v3': parakeet },
    language,
  };
}

const show = (value: VoiceStatus) =>
  render(<SpeechModels status={value} onStatus={() => undefined} />);

it('shows Parakeet alone, with its size, no picker and no remove', () => {
  show(status(ready));
  expect(screen.getByRole('region', { name: 'Speech model' })).toBeTruthy();
  expect(screen.getByText('Parakeet')).toBeTruthy();
  expect(screen.getByText('549 MB')).toBeTruthy();
  expect(screen.getByText('Ready')).toBeTruthy();
  expect(screen.queryAllByRole('radio')).toHaveLength(0);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByText(/Whisper/)).toBeNull();
  expect(screen.getByText(/Parakeet by NVIDIA, CC BY 4.0/)).toBeTruthy();
});

it('offers Download when the file is missing', () => {
  show(status(missing));
  expect(screen.getByText('Not downloaded')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Download Parakeet, 549 MB' }));
  expect(speech.download).toHaveBeenCalledTimes(1);
});

it('a download shows its progress and can be cancelled', () => {
  show(status({ state: 'downloading', progress: 0.42, problem: null }));
  expect(screen.getByText('Downloading 42%')).toBeTruthy();
  expect(screen.getByRole('progressbar', { name: 'Parakeet download' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Parakeet download' }));
  expect(speech.cancelDownload).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: /^Download/ })).toBeNull();
});

it('shows a failed download’s reason and offers it again', () => {
  show(status({ state: 'failed', progress: null, problem: 'The download didn’t check out.' }));
  expect(screen.getByText('The download didn’t check out.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^Download Parakeet/ }));
  expect(speech.download).toHaveBeenCalledTimes(1);
});

it('says when Parakeet doesn’t cover the Mac’s language, and stays quiet when it does', () => {
  show(status(ready, 'ja'));
  expect(
    screen.getByText(
      /Parakeet doesn’t cover Japanese, your Mac’s language, and may transcribe it poorly/,
    ),
  ).toBeTruthy();
  cleanup();
  show(status(ready, 'de'));
  expect(screen.queryByText(/your Mac’s language/)).toBeNull();
});
