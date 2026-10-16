import { describe, expect, it } from 'vitest';
import { VOICE_DEFAULT_SETTINGS } from '@spark-outpost/contracts';
import { denyAppRecording } from './app-microphone.ts';
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

describe('denyAppRecording', () => {
  it('denies the microphone to the app’s own windows and leaves other permissions alone', () => {
    let request:
      | ((contents: unknown, permission: string, callback: (granted: boolean) => void) => void)
      | null = null;
    let check: ((contents: unknown, permission: string) => boolean) | null = null;
    denyAppRecording({
      setPermissionRequestHandler: (handler) => void (request = handler),
      setPermissionCheckHandler: (handler) => void (check = handler),
    });
    const answers: Record<string, boolean> = {};
    for (const permission of [
      'media',
      'speaker-selection',
      'clipboard-sanitized-write',
      'notifications',
    ])
      request!(null, permission, (granted) => void (answers[permission] = granted));
    expect(answers).toEqual({
      media: false,
      'speaker-selection': false,
      'clipboard-sanitized-write': true,
      notifications: true,
    });
    expect(check!(null, 'media')).toBe(false);
    expect(check!(null, 'clipboard-read')).toBe(true);
  });
});
