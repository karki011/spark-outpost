import { describe, expect, it } from 'vitest';
import { VOICE_DEFAULT_SETTINGS } from '@spark-outpost/contracts';
import { parseVoiceSettings } from './voice-settings.ts';

describe('parseVoiceSettings', () => {
  it('starts off, with Speak answers off and ⌥⇧V', () => {
    expect(parseVoiceSettings(null)).toEqual(VOICE_DEFAULT_SETTINGS);
    expect(VOICE_DEFAULT_SETTINGS).toMatchObject({
      enabled: false,
      speakAnswers: false,
      shortcut: 'Alt+Shift+V',
    });
  });

  it('keeps saved choices and drops what it cannot read', () => {
    expect(
      parseVoiceSettings(JSON.stringify({ enabled: true, speakAnswers: true, shortcutMode: 'fn' })),
    ).toMatchObject({ enabled: true, speakAnswers: true, shortcutMode: 'fn' });
    expect(parseVoiceSettings('{not json')).toEqual(VOICE_DEFAULT_SETTINGS);
    expect(parseVoiceSettings(JSON.stringify({ shortcutMode: 'wake word' }))).toEqual(
      VOICE_DEFAULT_SETTINGS,
    );
    expect(parseVoiceSettings(JSON.stringify({ shortcut: 'V' })).shortcut).toBe('Alt+Shift+V');
  });

  it('a saved choice of a retired model reads back as Parakeet and keeps Voice on', () => {
    for (const model of ['whisper-base', 'whisper-large-v3-turbo']) {
      expect(parseVoiceSettings(JSON.stringify({ enabled: true, model }))).toEqual({
        ...VOICE_DEFAULT_SETTINGS,
        enabled: true,
        model: 'parakeet-v3',
      });
    }
  });

  it('a file from before speech models and an unknown model both read as Parakeet', () => {
    const before = JSON.stringify({
      enabled: true,
      speakAnswers: false,
      shortcutMode: 'keys',
      shortcut: 'Alt+Shift+V',
      hold: false,
    });
    expect(parseVoiceSettings(before)).toEqual({
      ...VOICE_DEFAULT_SETTINGS,
      enabled: true,
      model: 'parakeet-v3',
    });
    expect(parseVoiceSettings(JSON.stringify({ enabled: true, model: 'parakeet-en' }))).toEqual({
      ...VOICE_DEFAULT_SETTINGS,
      enabled: true,
    });
  });
});
