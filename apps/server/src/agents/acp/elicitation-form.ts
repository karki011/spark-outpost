import * as acp from '@agentclientprotocol/sdk';
import {
  AGENT_QUESTION_FIELDS_MAX,
  agentFormSchema,
  type AgentField,
  type AgentFieldKind,
  type AgentForm,
} from '@spark-outpost/contracts';
import { z } from 'zod';

const CLAUDE_CUSTOM_ANSWER = '_askUserQuestionCustomAnswer';
const CODEX_OTHER_OPTION = 'None of the above';

const enumOptionSchema = z.object({ const: z.string(), title: z.string().min(1) });
const nullable = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? null);

const propertySchema = z.object({
  type: z.string(),
  title: nullable(z.string()),
  description: nullable(z.string()),
  enum: nullable(z.array(z.string())),
  oneOf: nullable(z.array(enumOptionSchema)),
  items: nullable(
    z.object({
      enum: nullable(z.array(z.string())),
      anyOf: nullable(z.array(enumOptionSchema)),
    }),
  ),
  minimum: nullable(z.number()),
  maximum: nullable(z.number()),
  minLength: nullable(z.number().int().nonnegative()),
  maxLength: nullable(z.number().int().nonnegative()),
  minItems: nullable(z.number().int().nonnegative()),
  maxItems: nullable(z.number().int().nonnegative()),
  default: nullable(z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])),
  _meta: nullable(z.record(z.string(), z.unknown())),
});
type Property = z.infer<typeof propertySchema>;

const formSchema = z.object({
  type: z.literal('object').optional(),
  properties: z.record(z.string(), z.unknown()),
  required: nullable(z.array(z.string())),
});

const companionSchema = z.object({ questionId: z.string() });
const codexMetaSchema = z.object({
  role: z.string().optional(),
  questionId: z.string().optional(),
  isSecret: z.boolean().nullish(),
});

export const SECRET_REFUSAL = 'Spark does not ask for secrets in a question card.';

function invalid(message: string): never {
  throw acp.RequestError.invalidParams(undefined, message);
}

function codexMeta(property: Property) {
  const parsed = codexMetaSchema.safeParse(property._meta?.codex);
  return parsed.success ? parsed.data : null;
}

function companionOf(property: Property): string | null {
  const claude = companionSchema.safeParse(property._meta?.[CLAUDE_CUSTOM_ANSWER]);
  if (claude.success) return claude.data.questionId;
  const codex = codexMeta(property);
  return codex?.role === 'user_note' && codex.questionId ? codex.questionId : null;
}

function options(values: readonly string[] | null, titled: Property['oneOf']) {
  if (titled) return titled.map((option) => ({ value: option.const, label: option.title }));
  return (values ?? []).map((value) => ({ value, label: value }));
}

function kindOf(key: string, property: Property): AgentFieldKind {
  switch (property.type) {
    case 'string':
      return property.oneOf || property.enum ? 'one' : 'text';
    case 'number':
    case 'integer':
    case 'boolean':
      return property.type;
    case 'array':
      if (property.items?.anyOf || property.items?.enum) return 'many';
      return invalid(`Field "${key}" asks for a list Spark can't show as choices.`);
    default:
      return invalid(`Field "${key}" has a type Spark can't ask about: ${property.type}.`);
  }
}

function questionText(key: string, property: Property): string {
  const named = [property.title, property.description].filter((text): text is string =>
    Boolean(text?.trim()),
  );
  const longest = named.sort((a, b) => b.length - a.length)[0];
  return (longest ?? key).trim();
}

function otherOption(property: Property, choices: readonly { value: string }[]): string | null {
  if (!codexMeta(property)) return null;
  return choices.find((choice) => choice.value === CODEX_OTHER_OPTION)?.value ?? null;
}

function toField(key: string, property: Property, required: boolean, note: string | null) {
  const kind = kindOf(key, property);
  const choices =
    kind === 'many'
      ? options(property.items?.enum ?? null, property.items?.anyOf ?? null)
      : options(property.enum, property.oneOf);
  const labels = choices.map((choice) => choice.label);
  if (new Set(labels).size !== labels.length) invalid(`Field "${key}" repeats an answer.`);
  if ((kind === 'one' || kind === 'many') && choices.length === 0) {
    invalid(`Field "${key}" offers no answers.`);
  }
  const field: AgentField = {
    key,
    kind,
    question: questionText(key, property),
    options: choices,
    required,
    noteKey: note,
    otherValue: note && kind === 'one' ? otherOption(property, choices) : null,
    minimum: property.minimum,
    maximum: property.maximum,
    minLength: property.minLength,
    maxLength: property.maxLength,
    minItems: property.minItems,
    maxItems: property.maxItems,
    default: property.default,
  };
  return field;
}

function parsedProperties(raw: Record<string, unknown>): [string, Property][] {
  return Object.entries(raw).map(([key, value]) => {
    const parsed = propertySchema.safeParse(value);
    if (!parsed.success) invalid(`Field "${key}" is not a schema Spark can ask about.`);
    if (codexMeta(parsed.data)?.isSecret) invalid(SECRET_REFUSAL);
    return [key, parsed.data];
  });
}

function notesByQuestion(properties: readonly [string, Property][]): Map<string, string> {
  const keys = new Set(properties.map(([key]) => key));
  const notes = new Map<string, string>();
  for (const [key, property] of properties) {
    const question = companionOf(property);
    if (question === null || property.type !== 'string' || !keys.has(question)) continue;
    if (question !== key && !notes.has(question)) notes.set(question, key);
  }
  return notes;
}

function askedInMessage(
  field: AgentField,
  properties: readonly [string, Property][],
  message: string,
): AgentField[] {
  const propertyOf = (key: string | null) => properties.find(([name]) => name === key)?.[1];
  const described = Boolean(propertyOf(field.key)?.description?.trim());
  const claudeAsks = propertyOf(field.noteKey)?._meta?.[CLAUDE_CUSTOM_ANSWER] !== undefined;
  if (described || !claudeAsks || !message.trim()) return [field];
  return [{ ...field, question: message.trim() }];
}

export function agentForm(params: acp.CreateElicitationRequest): AgentForm {
  if (params.mode !== 'form') invalid('Spark answers form elicitations only.');
  const schema = formSchema.safeParse((params as { requestedSchema?: unknown }).requestedSchema);
  if (!schema.success) invalid('The requested schema is not a flat object form.');
  const properties = parsedProperties(schema.data.properties);
  const notes = notesByQuestion(properties);
  const companions = new Set(notes.values());
  const required = new Set(schema.data.required ?? []);
  const fields = properties
    .filter(([key]) => !companions.has(key))
    .map(([key, property]) => toField(key, property, required.has(key), notes.get(key) ?? null));
  if (fields.length === 0) invalid('The form asks nothing.');
  if (fields.length > AGENT_QUESTION_FIELDS_MAX) invalid('The form asks too many questions.');
  const asked =
    fields.length === 1 ? askedInMessage(fields[0]!, properties, params.message) : fields;
  const form = agentFormSchema.safeParse({ message: params.message, fields: asked });
  if (!form.success) invalid('The form is too large to show as a question card.');
  return form.data;
}
