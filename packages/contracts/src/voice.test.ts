import { describe, expect, it } from 'vitest';
import {
  recommendedVoiceModel,
  VOICE_MODELS,
  VOICE_WHISPER_BASE,
  voiceModel,
  voiceModelHears,
} from './voice.ts';

describe('recommendedVoiceModel', () => {
  it('recommends Parakeet on Apple silicon in a language it hears', () => {
    expect(recommendedVoiceModel('arm64', 'en')).toBe('parakeet-v3');
    expect(recommendedVoiceModel('arm64', 'uk')).toBe('parakeet-v3');
  });

  it('recommends Whisper base on Intel, whatever the language', () => {
    expect(recommendedVoiceModel('x64', 'en')).toBe('whisper-base');
  });

  it('recommends Whisper base on Apple silicon in a language Parakeet lacks', () => {
    expect(recommendedVoiceModel('arm64', 'ja')).toBe('whisper-base');
    expect(recommendedVoiceModel('arm64', 'nb')).toBe('whisper-base');
  });
});

describe('the speech model manifest', () => {
  it('offers three models with distinct files, pinned to a commit', () => {
    expect(VOICE_MODELS.map((model) => model.id)).toEqual([
      'parakeet-v3',
      'whisper-base',
      'whisper-large-v3-turbo',
    ]);
    expect(new Set(VOICE_MODELS.map((model) => model.file)).size).toBe(3);
    for (const model of VOICE_MODELS) {
      expect(model.url).toMatch(/^https:\/\/huggingface\.co\/.+\/resolve\/[0-9a-f]{40}\//);
      expect(model.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('keeps the Whisper base file existing users already have', () => {
    expect(voiceModel('whisper-base')).toMatchObject(VOICE_WHISPER_BASE);
  });

  it('Whisper hears any language; Parakeet only its 25', () => {
    expect(voiceModelHears(voiceModel('whisper-large-v3-turbo'), 'ja')).toBe(true);
    expect(voiceModelHears(voiceModel('parakeet-v3'), 'ja')).toBe(false);
    expect(voiceModel('parakeet-v3').languages).toHaveLength(25);
  });
});
