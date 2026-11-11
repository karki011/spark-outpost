import { shortModelLabel } from '@spark-outpost/contracts';
import { z } from 'zod';

const MODEL_CATEGORY = 'model';
const EFFORT_CATEGORY = 'thought_level';
const AGENT_DEFAULT = 'default';

const MODEL_ALIAS = /^[a-z]+$/i;

const optionSchema = z.looseObject({
  category: z.string().optional(),
  currentValue: z.unknown(),
  options: z.array(z.looseObject({ value: z.unknown(), name: z.unknown() })).optional(),
});

type Option = z.infer<typeof optionSchema>;

export interface SubagentConfiguration {
  model?: string;
  effort?: string;
}

function chosen(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text !== AGENT_DEFAULT ? text : null;
}

function modelName(option: Option | undefined): string | null {
  const value = chosen(option?.currentValue);
  if (!value) return null;
  if (!MODEL_ALIAS.test(value.replace(/\[[^\]]*\]$/, ''))) return value;
  const named = option?.options?.find((entry) => entry.value === option.currentValue)?.name;
  const name = chosen(named);
  return name ? shortModelLabel(name) : value;
}

export function subagentConfiguration(configOptions: unknown): SubagentConfiguration {
  const options = z.array(optionSchema).safeParse(configOptions);
  if (!options.success) return {};
  const optionOf = (category: string) =>
    options.data.find((option) => option.category === category);
  const model = modelName(optionOf(MODEL_CATEGORY));
  const effort = chosen(optionOf(EFFORT_CATEGORY)?.currentValue);
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}
