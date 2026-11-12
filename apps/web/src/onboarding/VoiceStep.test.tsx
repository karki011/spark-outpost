// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { VOICE_DEFAULT_SETTINGS, type VoiceStatus } from '@spark-outpost/contracts';
import { voiceContinueLabel, VoiceStep } from './VoiceStep.tsx';

afterEach(cleanup);

function status(state: 'missing' | 'ready'): VoiceStatus {
  return {
    supported: true,
    helper: 'ready',
    settings: VOICE_DEFAULT_SETTINGS,
    mic: 'not_determined',
    inputMonitoring: false,
    fnSetting: 'emoji',
    fnActive: false,
    shortcutFailed: false,
    model: state,
    models: { 'parakeet-v3': { state, progress: null, problem: null } },
    language: 'en',
  };
}

it('names the download size on the button, and just continues once it is there or for Not now', () => {
  expect(voiceContinueLabel('parakeet-v3', status('missing'))).toBe('Download 549 MB and continue');
  expect(voiceContinueLabel('parakeet-v3', null)).toBe('Download 549 MB and continue');
  expect(voiceContinueLabel('parakeet-v3', status('ready'))).toBe('Continue');
  expect(voiceContinueLabel('none', status('missing'))).toBe('Continue');
});

it('offers the Parakeet download or Not now, with no model to pick between', () => {
  const choose = vi.fn();
  render(<VoiceStep choice="parakeet-v3" onChoose={choose} />);
  const group = screen.getByRole('radiogroup', { name: 'Talk to Spark' });
  expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(2);
  const parakeet = screen.getByRole('radio', { name: /^Parakeet/ }) as HTMLInputElement;
  expect(parakeet.checked).toBe(true);
  expect(screen.queryByText(/Whisper/)).toBeNull();
  expect(screen.queryByText('Recommended for you')).toBeNull();
  fireEvent.click(screen.getByRole('radio', { name: /^Not now/ }));
  expect(choose).toHaveBeenCalledWith('none');
  expect(screen.getByText('Audio never leaves this Mac')).toBeTruthy();
});
