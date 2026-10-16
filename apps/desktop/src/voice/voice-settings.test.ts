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
});
