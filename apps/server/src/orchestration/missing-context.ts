import { CHECKPOINT_OPTION, checkpointPayloadSchema } from '@spark-outpost/contracts';
import type { CheckpointCard } from './checkpoint.ts';

export const CONTEXT_QUESTION = 'What should the Builder look at?';

const SENTENCE_LIMIT = 240;

const MISSING =
  /\b(?:could(?:n'?t| not)|can(?:'?t|not)|unable to|did(?:n'?t| not)) (?:find|locate|see)\b|\bno such file\b|\bENOENT\b|\bthere (?:is|are) no (?:such )?(?:file|folder|directory|path)s?\b|\bthere (?:is|are) no \S+\.\w{1,5}\b|\b(?:does(?:n'?t| not)|did(?:n'?t| not)) exist\b|\btoo vague\b|\bunclear what\b|\bnot (?:sure|clear) what (?:you|to)\b|\bneed (?:more )?(?:clarification|context|details)\b|\b(?:please |can you |could you )(?:clarify|specify)\b|\bwhich (?:file|files|part|component|function|test|module)\b[^.?!]*\?/i;

const SENTENCE_BREAK = /(?<=[.?!])\s+|\n+/;

function clip(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length > SENTENCE_LIMIT ? `${trimmed.slice(0, SENTENCE_LIMIT - 1)}…` : trimmed;
}

function missingSentence(text: string): string | null {
  for (const sentence of text.split(SENTENCE_BREAK)) {
    if (MISSING.test(sentence)) return clip(sentence);
  }
  return null;
}

export function missingContext(text: string, error: string | null): string | null {
  return missingSentence(text) ?? (error ? missingSentence(error) : null);
}

export function contextCard(reason: string): CheckpointCard {
  return {
    kind: 'clarify',
    title: CONTEXT_QUESTION,
    payload: checkpointPayloadSchema.parse({ kind: 'clarify', question: CONTEXT_QUESTION, reason }),
    options: [
      { optionId: CHECKPOINT_OPTION.answer, name: 'Answer in your own words', kind: 'allow_once' },
      { optionId: CHECKPOINT_OPTION.stop, name: 'Stop', kind: 'reject_once' },
    ],
  };
}
