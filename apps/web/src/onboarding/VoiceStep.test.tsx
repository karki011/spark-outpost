// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { VOICE_DEFAULT_SETTINGS, type VoiceStatus } from '@spark-outpost/contracts';
import { recommendedChoice, voiceContinueLabel, VoiceStep } from './VoiceStep.tsx';

afterEach(cleanup);

const missing = { state: 'missing', progress: null, problem: null } as const;

function status(arch: VoiceStatus['arch'], language: string): VoiceStatus {
  return {
    supported: true,
    helper: 'ready',
    settings: VOICE_DEFAULT_SETTINGS,
    mic: 'not_determined',
    inputMonitoring: false,
    fnSetting: 'emoji',
    fnActive: false,
    shortcutFailed: false,
    model: 'missing',
    models: {
      'parakeet-v3': missing,
      'whisper-base': { state: 'ready', progress: null, problem: null },
      'whisper-large-v3-turbo': missing,
    },
    arch,
    language,
  };
}

it('recommends Parakeet on Apple silicon in its languages, otherwise Whisper base', () => {
  expect(recommendedChoice(status('arm64', 'de'))).toBe('parakeet-v3');
  expect(recommendedChoice(status('x64', 'de'))).toBe('whisper-base');
  expect(recommendedChoice(status('arm64', 'zh'))).toBe('whisper-base');
  expect(recommendedChoice(null)).toBe('whisper-base');
});

it('names the download size on the button, and just continues for Not now', () => {
  const now = status('arm64', 'en');
  expect(voiceContinueLabel('parakeet-v3', now)).toBe('Download 549 MB and continue');
  expect(voiceContinueLabel('whisper-large-v3-turbo', now)).toBe('Download 574 MB and continue');
  expect(voiceContinueLabel('whisper-base', now)).toBe('Continue');
  expect(voiceContinueLabel('none', now)).toBe('Continue');
  expect(voiceContinueLabel('whisper-base', null)).toBe('Download 60 MB and continue');
});

it('offers the three models and Not now as one radio group, marking the recommended one', () => {
  const choose = vi.fn();
  render(<VoiceStep choice="parakeet-v3" recommended="parakeet-v3" onChoose={choose} />);
  const group = screen.getByRole('radiogroup', { name: 'Talk to Spark' });
  const radios = group.querySelectorAll('input[type="radio"]');
  expect(radios).toHaveLength(4);
  const parakeet = screen.getByRole('radio', { name: /^Parakeet/ }) as HTMLInputElement;
  expect(parakeet.checked).toBe(true);
  expect(parakeet.closest('label')?.textContent).toContain('Recommended for you');
  expect(screen.getAllByText('Recommended for you')).toHaveLength(1);
  fireEvent.click(screen.getByRole('radio', { name: /^Not now/ }));
  expect(choose).toHaveBeenCalledWith('none');
  expect(screen.getByText('Audio never leaves this Mac')).toBeTruthy();
});
