import { voiceModelHears, type VoiceModel } from '@spark-outpost/contracts';

export const MODEL_SUMMARY =
  'Understands English and 24 other European languages, and tells them apart on its own.';

export const MODEL_CREDIT =
  'Parakeet by NVIDIA, CC BY 4.0, converted to GGUF. It downloads from Hugging Face at a pinned version and is checked before use.';

export function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000).toLocaleString('en-US')} MB`;
}

export function languageCount(model: VoiceModel): string {
  return `${model.languages.length} languages`;
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
  return `${model.name} doesn’t cover ${languageName(language)}, your Mac’s language, and may transcribe it poorly.`;
}
