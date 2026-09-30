import { z } from 'zod';
import {
  CHECKPOINT_OPTION,
  checkpointPayloadSchema,
  clarifyOptionId,
} from '@spark-outpost/contracts';
import type { CheckpointCard } from './checkpoint.ts';

const CLARIFY_TITLE = 'A few questions first';
const MAX_QUESTIONS = 3;
const MAX_OPTIONS = 4;
const TEXT_LIMIT = 300;

export const CLARIFY_NOTE = [
  'The request is too vague to act on yet. Do not change any files.',
  'Read the code the request most likely refers to, then ask the user 1 to 3 short, specific questions that would settle what they want, each with your best guess as the default.',
  'Write the questions for the user as a short numbered list, then end your reply with this block and nothing after it:',
  '```clarify',
  '{"questions":[{"question":"<your question>","options":["<quick reply>"],"default":"<your best guess>"}]}',
  '```',
  'Options are optional quick replies, at most 4 short ones.',
].join('\n');

const PLACEHOLDER = /^<.*>$/;
const filled = z
  .string()
  .trim()
  .min(1)
  .max(TEXT_LIMIT)
  .refine((text) => !PLACEHOLDER.test(text));

const questionSchema = z.object({
  question: filled,
  options: z.array(filled).max(MAX_OPTIONS).optional(),
  default: filled,
});
export type ClarifyQuestion = z.infer<typeof questionSchema>;

const blockSchema = z.object({
  questions: z.array(questionSchema).min(1).max(MAX_QUESTIONS),
});

const BLOCK = /```clarify\s*\n([\s\S]*?)\n?```/;
const BLOCK_ANYWHERE = /\n*```clarify[\s\S]*?(?:```|$)\s*/g;

export function clarifyQuestions(text: string): ClarifyQuestion[] | null {
  const raw = BLOCK.exec(text)?.[1];
  if (!raw) return null;
  try {
    const parsed = blockSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.questions : null;
  } catch {
    return null;
  }
}

export function stripClarifyBlock(text: string): string {
  return text.replace(BLOCK_ANYWHERE, '').trim();
}

function guesses(questions: readonly ClarifyQuestion[]): string {
  return questions
    .map((question) => `${question.question} (best guess: ${question.default})`)
    .join(' ');
}

export function clarifyCard(
  questions: readonly ClarifyQuestion[],
  agent: string | null = null,
): CheckpointCard {
  const choices = questions.length === 1 ? (questions[0]!.options ?? []) : [];
  const payload = checkpointPayloadSchema.parse({
    kind: 'clarify',
    question: CLARIFY_TITLE,
    reason: guesses(questions),
    choices,
    questions: questions.map((question) => ({
      question: question.question,
      options: question.options ?? [],
      default: question.default,
    })),
    autoOption: CHECKPOINT_OPTION.useDefaults,
    agent,
  });
  return {
    kind: 'clarify',
    title: CLARIFY_TITLE,
    payload,
    options: [
      ...choices.map((choice, index) => ({
        optionId: clarifyOptionId(index),
        name: choice,
        kind: 'allow_once' as const,
      })),
      { optionId: CHECKPOINT_OPTION.answer, name: 'Answer in your own words', kind: 'allow_once' },
      {
        optionId: CHECKPOINT_OPTION.useDefaults,
        name: 'Go with my best guesses',
        kind: 'allow_once',
      },
      { optionId: CHECKPOINT_OPTION.stop, name: 'Stop', kind: 'reject_once' },
    ],
  };
}

export type ClarifyReply =
  { kind: 'choice' | 'own_words'; text: string } | { kind: 'defaults'; text: null };

export function clarifyReply(
  card: CheckpointCard,
  questions: readonly ClarifyQuestion[],
  optionId: string,
  note: string | null,
): ClarifyReply | null {
  if (optionId === CHECKPOINT_OPTION.stop) return null;
  const written = note?.trim();
  if (optionId === CHECKPOINT_OPTION.answer && written) return { kind: 'own_words', text: written };
  const index = card.options.findIndex((option) => option.optionId === optionId);
  const picked = questions.length === 1 ? questions[0]!.options?.[index] : undefined;
  return picked ? { kind: 'choice', text: picked } : { kind: 'defaults', text: null };
}

function questionLines(questions: readonly ClarifyQuestion[]): string {
  return questions
    .map((question) => `- ${question.question} (default: ${question.default})`)
    .join('\n');
}

export function requestWithAnswers(
  request: string,
  questions: readonly ClarifyQuestion[],
  reply: ClarifyReply,
): string {
  const answer =
    reply.text === null
      ? 'No answer, so go with the defaults.'
      : `The user answered: ${reply.text}\nWhere the answer does not cover a question, use its default.`;
  return `${request}\n\nClarifying questions asked:\n${questionLines(questions)}\n\n${answer}`;
}

export function clarifyPrNote(questions: readonly ClarifyQuestion[], reply: ClarifyReply): string {
  if (reply.text !== null) {
    const asked = questions.map((question) => `- ${question.question}`).join('\n');
    return `Clarifying questions (answered by the user):\n${asked}\nAnswer: ${reply.text}`;
  }
  const lines = questions.map((question) => `- ${question.question} → ${question.default}`);
  return `Clarifying questions (no answer, went with the defaults):\n${lines.join('\n')}`;
}
