import { z } from 'zod';
import type { CheckpointQuestion } from './checkpoints.ts';

export const AGENT_QUESTION_FIELDS_MAX = 20;
export const AGENT_QUESTION_OPTIONS_MAX = 50;
const TEXT_MAX = 2000;
const KEY_MAX = 200;
const ANSWER_MAX = 4000;

export const agentFieldKindSchema = z.enum(['one', 'many', 'text', 'number', 'integer', 'boolean']);
export type AgentFieldKind = z.infer<typeof agentFieldKindSchema>;

const fieldValueSchema = z.union([
  z.string().max(ANSWER_MAX),
  z.number(),
  z.boolean(),
  z.array(z.string().max(TEXT_MAX)).max(AGENT_QUESTION_OPTIONS_MAX),
]);
export type AgentFieldValue = z.infer<typeof fieldValueSchema>;

const fieldOptionSchema = z.object({
  value: z.string().max(TEXT_MAX),
  label: z.string().min(1).max(TEXT_MAX),
});

const bound = z.number().nullable();
const count = z.number().int().nonnegative().nullable();

export const agentFieldSchema = z.object({
  key: z.string().min(1).max(KEY_MAX),
  kind: agentFieldKindSchema,
  question: z.string().min(1).max(TEXT_MAX),
  options: z.array(fieldOptionSchema).max(AGENT_QUESTION_OPTIONS_MAX),
  required: z.boolean(),
  noteKey: z.string().min(1).max(KEY_MAX).nullable(),
  otherValue: z.string().max(TEXT_MAX).nullable(),
  minimum: bound,
  maximum: bound,
  minLength: count,
  maxLength: count,
  minItems: count,
  maxItems: count,
  default: fieldValueSchema.nullable(),
});
export type AgentField = z.infer<typeof agentFieldSchema>;

export const agentFormSchema = z.object({
  message: z.string().max(TEXT_MAX),
  fields: z.array(agentFieldSchema).min(1).max(AGENT_QUESTION_FIELDS_MAX),
});
export type AgentForm = z.infer<typeof agentFormSchema>;

export const questionAnswerSchema = z.object({
  picks: z.array(z.string().max(TEXT_MAX)).max(AGENT_QUESTION_OPTIONS_MAX),
  text: z.string().max(ANSWER_MAX),
});
export type QuestionAnswerInput = z.infer<typeof questionAnswerSchema>;

export const agentAnswersSchema = z.array(questionAnswerSchema).max(AGENT_QUESTION_FIELDS_MAX);

export const agentContentSchema = z.record(z.string(), fieldValueSchema);
export type AgentContent = z.infer<typeof agentContentSchema>;

const BOOLEAN_OPTIONS = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];

export function fieldOptions(field: AgentField): { value: string; label: string }[] {
  return field.kind === 'boolean' ? BOOLEAN_OPTIONS : field.options;
}

function takesText(field: AgentField): boolean {
  if (field.kind === 'text' || field.kind === 'number' || field.kind === 'integer') return true;
  return field.noteKey !== null;
}

function defaultLabel(field: AgentField): string {
  const value = field.default;
  if (value === null || Array.isArray(value)) return '';
  const known = fieldOptions(field).find((option) => option.value === String(value));
  if (known) return known.label;
  return field.options.length > 0 ? '' : String(value);
}

export function formQuestions(form: AgentForm): CheckpointQuestion[] {
  return form.fields.map((field) => ({
    question: field.question,
    options: fieldOptions(field).map((option) => option.label),
    default: defaultLabel(field),
    pick: field.kind === 'many' ? 'many' : 'one',
    freeText: takesText(field),
  }));
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const failed = (error: string): Result<never> => ({ ok: false, error });

function pickedValues(field: AgentField, picks: readonly string[]): Result<string[]> {
  const values: string[] = [];
  for (const pick of picks) {
    const option = fieldOptions(field).find((candidate) => candidate.label === pick);
    if (!option) return failed(`Pick one of the answers offered for “${field.question}”.`);
    values.push(option.value);
  }
  return { ok: true, value: values };
}

function typedNumber(field: AgentField, raw: string): Result<number> {
  const value = Number(raw);
  if (raw === '' || !Number.isFinite(value)) {
    return failed(`Answer “${field.question}” with a number.`);
  }
  if (field.kind === 'integer' && !Number.isInteger(value)) {
    return failed(`Answer “${field.question}” with a whole number.`);
  }
  if (field.minimum !== null && value < field.minimum) {
    return failed(`“${field.question}” needs ${field.minimum} or more.`);
  }
  if (field.maximum !== null && value > field.maximum) {
    return failed(`“${field.question}” needs ${field.maximum} or less.`);
  }
  return { ok: true, value };
}

function typedText(field: AgentField, text: string): Result<string> {
  if (field.minLength !== null && text.length < field.minLength) {
    return failed(`“${field.question}” needs at least ${field.minLength} characters.`);
  }
  if (field.maxLength !== null && text.length > field.maxLength) {
    return failed(`“${field.question}” takes at most ${field.maxLength} characters.`);
  }
  return { ok: true, value: text };
}

function chosenCount(field: AgentField, values: string[]): Result<string[]> {
  if (field.minItems !== null && values.length < field.minItems) {
    return failed(`Pick at least ${field.minItems} for “${field.question}”.`);
  }
  if (field.maxItems !== null && values.length > field.maxItems) {
    return failed(`Pick at most ${field.maxItems} for “${field.question}”.`);
  }
  return { ok: true, value: values };
}

function mainValue(
  field: AgentField,
  values: string[],
  text: string,
): Result<AgentFieldValue | null> {
  const typed = text || values[0] || '';
  switch (field.kind) {
    case 'many':
      return values.length > 0 ? chosenCount(field, values) : { ok: true, value: null };
    case 'boolean':
      return { ok: true, value: values[0] === undefined ? null : values[0] === 'true' };
    case 'one':
      return { ok: true, value: values[0] ?? null };
    case 'text':
      return typed ? typedText(field, typed) : { ok: true, value: null };
    case 'number':
    case 'integer':
      return typed ? typedNumber(field, typed) : { ok: true, value: null };
  }
}

function fieldContent(field: AgentField, answer: QuestionAnswerInput): Result<AgentContent> {
  const text = answer.text.trim();
  if (text && !takesText(field)) {
    return failed(`Pick one of the answers offered for “${field.question}”.`);
  }
  const single = field.kind !== 'many';
  if (single && answer.picks.length > 1) return failed(`Pick one answer for “${field.question}”.`);
  const picked = pickedValues(field, answer.picks);
  if (!picked.ok) return picked;
  const main = mainValue(field, picked.value, field.noteKey ? '' : text);
  if (!main.ok) return main;
  const content: AgentContent = {};
  const value = main.value ?? field.default;
  if (value !== null) content[field.key] = value;
  else if (field.required && !(field.noteKey && text)) return failed(`Answer “${field.question}”.`);
  if (field.noteKey && text) {
    content[field.noteKey] = text;
    if (value === null && field.otherValue !== null) content[field.key] = field.otherValue;
  }
  return { ok: true, value: content };
}

export function formContent(
  form: AgentForm,
  answers: readonly QuestionAnswerInput[],
): Result<AgentContent> {
  if (answers.length !== form.fields.length) {
    return failed('Answer the questions shown on the card.');
  }
  const content: AgentContent = {};
  for (const [index, field] of form.fields.entries()) {
    const result = fieldContent(field, answers[index]!);
    if (!result.ok) return result;
    Object.assign(content, result.value);
  }
  return { ok: true, value: content };
}
