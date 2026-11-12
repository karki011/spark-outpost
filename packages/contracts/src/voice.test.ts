import { describe, expect, it } from 'vitest';
import {
  VOICE_DEFAULT_MODEL,
  VOICE_MODELS,
  voiceModel,
  voiceModelHears,
  voiceModelIdSchema,
} from './voice.ts';

describe('the speech model manifest', () => {
  it('holds only Parakeet, pinned to a commit and a checksum', () => {
    expect(VOICE_MODELS.map((model) => model.id)).toEqual(['parakeet-v3']);
    expect(VOICE_DEFAULT_MODEL).toBe('parakeet-v3');
    const model = voiceModel('parakeet-v3');
    expect(model.url).toMatch(/^https:\/\/huggingface\.co\/.+\/resolve\/[0-9a-f]{40}\//);
    expect(model.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('no longer accepts the retired Whisper ids', () => {
    expect(voiceModelIdSchema.safeParse('parakeet-v3').success).toBe(true);
    expect(voiceModelIdSchema.safeParse('whisper-base').success).toBe(false);
    expect(voiceModelIdSchema.safeParse('whisper-large-v3-turbo').success).toBe(false);
  });

  it('Parakeet hears its 25 languages and no others', () => {
    const parakeet = voiceModel('parakeet-v3');
    expect(parakeet.languages).toHaveLength(25);
    expect(voiceModelHears(parakeet, 'uk')).toBe(true);
    expect(voiceModelHears(parakeet, 'ja')).toBe(false);
  });
});
