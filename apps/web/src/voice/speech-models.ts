import {
  VOICE_WHISPER_LANGUAGE_COUNT,
  voiceModelHears,
  type VoiceModel,
  type VoiceModelId,
} from '@spark-outpost/contracts';

export const MODEL_SUMMARIES: Record<VoiceModelId, string> = {
  'parakeet-v3':
    'Most accurate for English and European languages, and tells them apart on its own. Fast on Apple silicon.',
  'whisper-base': 'Small and quick. Fine for short commands; misses more names.',
  'whisper-large-v3-turbo':
    'Best Whisper for languages Parakeet lacks. Slower, especially on Intel Macs.',
};

export const MODEL_CREDIT =
  'Parakeet by NVIDIA, CC BY 4.0, converted to GGUF. Whisper by OpenAI, MIT. Models download from Hugging Face at a pinned version and are checked before use.';

export function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000).toLocaleString('en-US')} MB`;
}

export function languageCount(model: VoiceModel): string {
  return `${model.languages?.length ?? VOICE_WHISPER_LANGUAGE_COUNT} languages`;
}

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function languageNote(model: VoiceModel, language: string): string | null {
  if (voiceModelHears(model, language)) return null;
  return `${model.name} doesn’t understand ${languageName(language)}, your Mac’s language. Whisper models do.`;
}
