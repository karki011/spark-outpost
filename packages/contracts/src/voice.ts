import { z } from 'zod';

export const VOICE_HELPER_NAME = 'spark-voice';

export interface VoiceModelFile {
  file: string;
  url: string;
  sha256: string;
  size: number;
}

export const VOICE_WHISPER_BASE: VoiceModelFile = {
  file: 'ggml-base-q5_1.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base-q5_1.bin',
  sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898',
  size: 59_707_625,
};

export const VOICE_SILERO: VoiceModelFile = {
  file: 'ggml-silero-v6.2.0.bin',
  url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin',
  sha256: '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987',
  size: 885_098,
};

export const VOICE_MICROPHONE_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';
export const VOICE_INPUT_MONITORING_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent';
export const VOICE_KEYBOARD_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.Keyboard-Settings.extension';

export const VOICE_DEFAULT_SHORTCUT = 'Alt+Shift+V';

export const voicePurposeSchema = z.enum(['command', 'dictation', 'confirm']);
export type VoicePurpose = z.infer<typeof voicePurposeSchema>;

export const voiceEndReasonSchema = z.enum(['stopped', 'paused', 'silence']);
export type VoiceEndReason = z.infer<typeof voiceEndReasonSchema>;

export const voiceErrorCodeSchema = z.enum([
  'invalid',
  'mic_denied',
  'no_input_device',
  'model_missing',
  'bad_model',
  'busy',
  'file_input_off',
  'failed',
]);
export type VoiceErrorCode = z.infer<typeof voiceErrorCodeSchema>;

export const voiceFnSettingSchema = z.enum(['free', 'input_source', 'emoji', 'dictation']);
export type VoiceFnSetting = z.infer<typeof voiceFnSettingSchema>;

export const voiceMicPermissionSchema = z.enum(['granted', 'denied', 'not_determined']);
export type VoiceMicPermission = z.infer<typeof voiceMicPermissionSchema>;

const id = z.string().min(1).max(100);
const text = z.string().max(20_000);

export const voiceHelperMessageSchema = z.discriminatedUnion('event', [
  z.object({
    id,
    event: z.literal('status'),
    mic: voiceMicPermissionSchema,
    inputMonitoring: z.boolean(),
    model: z.boolean(),
    fnSetting: voiceFnSettingSchema,
    arch: z.enum(['arm64', 'x64']),
  }),
  z.object({ id, event: z.literal('loaded') }),
  z.object({ id, event: z.literal('level'), level: z.number().min(0).max(1) }),
  z.object({ id, event: z.literal('speech') }),
  z.object({ id, event: z.literal('partial'), text }),
  z.object({ id, event: z.literal('final'), text, reason: voiceEndReasonSchema }),
  z.object({ id, event: z.literal('cancelled') }),
  z.object({ id, event: z.literal('spoken') }),
  z.object({ id, event: z.literal('interrupted') }),
  z.object({ id, event: z.literal('hushed') }),
  z.object({ id, event: z.literal('keys') }),
  z.object({ id, event: z.enum(['fn_twice', 'key_down', 'key_up']) }),
  z.object({
    id: id.nullable(),
    event: z.literal('error'),
    error: voiceErrorCodeSchema,
    detail: z.string().max(500),
  }),
]);
export type VoiceHelperMessage = z.infer<typeof voiceHelperMessageSchema>;

export const voiceShortcutModeSchema = z.enum(['fn', 'keys']);
export type VoiceShortcutMode = z.infer<typeof voiceShortcutModeSchema>;

export const voiceSettingsSchema = z.object({
  enabled: z.boolean(),
  speakAnswers: z.boolean(),
  shortcutMode: voiceShortcutModeSchema,
  shortcut: z.string().max(60),
  hold: z.boolean(),
});
export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;

export const VOICE_DEFAULT_SETTINGS: VoiceSettings = {
  enabled: false,
  speakAnswers: false,
  shortcutMode: 'keys',
  shortcut: VOICE_DEFAULT_SHORTCUT,
  hold: false,
};

export type VoiceModelState = 'missing' | 'downloading' | 'ready' | 'failed';

export interface VoiceStatus {
  supported: boolean;
  helper: 'ready' | 'missing' | 'failed';
  settings: VoiceSettings;
  mic: VoiceMicPermission;
  inputMonitoring: boolean;
  fnSetting: VoiceFnSetting;
  fnActive: boolean;
  shortcutFailed: boolean;
  model: VoiceModelState;
  progress: number | null;
  problem: string | null;
  language: string;
}

export type VoiceEvent =
  | { kind: 'press'; file?: string }
  | { kind: 'release' }
  | { kind: 'level'; id: string; level: number }
  | { kind: 'speech'; id: string }
  | { kind: 'partial'; id: string; text: string }
  | { kind: 'final'; id: string; text: string; reason: VoiceEndReason }
  | { kind: 'cancelled'; id: string }
  | { kind: 'error'; id: string; error: VoiceErrorCode }
  | { kind: 'spoken'; id: string; interrupted: boolean };

export type VoiceListenResult = { ok: true; id: string } | { ok: false; error: VoiceErrorCode };
