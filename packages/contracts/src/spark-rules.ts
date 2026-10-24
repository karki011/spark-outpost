import { z } from 'zod';

export const ghRuleChoiceSchema = z.enum(['refused', 'mode']);
export type GhRuleChoice = z.infer<typeof ghRuleChoiceSchema>;

export const DEFAULT_WORKFLOW_RULE: GhRuleChoice = 'mode';
export const GH_ALLOWED_MAX = 20;
export const WORKFLOW_PREFIXES = ['gh workflow run', 'gh run rerun', 'gh run cancel'] as const;

export const sparkRuleGroupSchema = z.enum(['workflows', 'other']);
export type SparkRuleGroup = z.infer<typeof sparkRuleGroupSchema>;

const GH_PREFIX = /^gh [a-z][a-z0-9-]* [a-z][a-z0-9-]*$/;

const READ_VERBS: Readonly<Record<string, readonly string[]>> = {
  pr: ['view', 'checks', 'status', 'diff', 'list'],
  run: ['view', 'list', 'watch'],
  issue: ['view', 'list', 'status'],
  repo: ['view'],
  release: ['view', 'list'],
};

export const NEVER_ALLOWED_NOTE =
  'Merging, approving or dismissing reviews and --admin stay refused even when added.';

export function tidyGhPrefix(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function ghPrefixProblem(text: string): string | null {
  const prefix = tidyGhPrefix(text);
  if (!GH_PREFIX.test(prefix)) return 'Use gh and two words, such as gh release create.';
  const [, group = '', verb = ''] = prefix.split(' ');
  if (group === 'api') return 'gh api can change anything, so only its reads are allowed.';
  if (group === 'auth') return 'gh auth reaches your GitHub sign-in, so it stays refused.';
  if (prefix === 'gh pr merge') return 'Spark never merges a pull request.';
  if (prefix === 'gh pr create') return 'Opening pull requests follows the publish rules.';
  if ((WORKFLOW_PREFIXES as readonly string[]).includes(prefix)) {
    return 'Workflows have their own rule: Run a workflow.';
  }
  if (group === 'search' || READ_VERBS[group]?.includes(verb)) {
    return 'Reading is always allowed.';
  }
  return null;
}

export const SPARK_FLOOR_RULE_IDS = [
  'Push',
  'Push(other)',
  'Push(force)',
  'PullRequest',
  'SecretFile(edit)',
  'SecretFile(read)',
  'InstructionFile(edit)',
  'GitConfig',
  'WriteOutside',
  'SecretSend',
  'GitRemote',
] as const;
export type SparkFloorRuleId = (typeof SPARK_FLOOR_RULE_IDS)[number];

export const HELD_ASK_RULES: readonly SparkFloorRuleId[] = [
  'Push(force)',
  'GitConfig',
  'SecretSend',
];

export const sparkRuleRowSchema = z.enum([...SPARK_FLOOR_RULE_IDS, 'workflows', 'Gh(*)']);
export type SparkRuleRow = z.infer<typeof sparkRuleRowSchema>;

export const sparkRuleChoiceSchema = z.enum(['mode', 'allow', 'ask', 'deny']);
export type SparkRuleChoice = z.infer<typeof sparkRuleChoiceSchema>;

export const sparkRuleSourceSchema = z.enum(['user', 'managed']);
export type SparkRuleSource = z.infer<typeof sparkRuleSourceSchema>;

export const sparkRuleRowStateSchema = z.object({
  row: sparkRuleRowSchema,
  ids: z.array(z.string()),
  choice: sparkRuleChoiceSchema.nullable(),
  source: sparkRuleSourceSchema.nullable(),
});
export type SparkRuleRowState = z.infer<typeof sparkRuleRowStateSchema>;

export const ghAllowedEntrySchema = z.object({
  prefix: z.string(),
  overridden: z.boolean(),
});
export type GhAllowedEntry = z.infer<typeof ghAllowedEntrySchema>;

export const unusedRuleEntrySchema = z.object({
  entry: z.string(),
  kind: z.enum(['key', 'rule', 'agent-tool']),
});
export type UnusedRuleEntry = z.infer<typeof unusedRuleEntrySchema>;

export const sparkRulesProblemSchema = z.object({
  file: sparkRuleSourceSchema,
  message: z.string(),
});
export type SparkRulesProblem = z.infer<typeof sparkRulesProblemSchema>;

export const sparkRulesSchema = z.object({
  rows: z.array(sparkRuleRowStateSchema),
  ghAllowed: z.array(ghAllowedEntrySchema),
  unused: z.array(unusedRuleEntrySchema),
  problems: z.array(sparkRulesProblemSchema),
  malformed: z.boolean(),
});
export type SparkRules = z.infer<typeof sparkRulesSchema>;

export const DEFAULT_SPARK_RULES = {
  workflows: DEFAULT_WORKFLOW_RULE,
  ghAllowed: [] as string[],
};

export const setSparkRuleRequestSchema = z.object({
  row: sparkRuleRowSchema,
  choice: sparkRuleChoiceSchema,
});
export type SetSparkRuleRequest = z.infer<typeof setSparkRuleRequestSchema>;

export const ghAllowedRequestSchema = z.object({
  prefix: z
    .string()
    .max(80)
    .transform(tidyGhPrefix)
    .refine((prefix) => ghPrefixProblem(prefix) === null, {
      message: 'Use gh and two words, such as gh release create.',
    }),
  allowed: z.boolean(),
});
export type GhAllowedRequest = z.input<typeof ghAllowedRequestSchema>;

export const sparkRulesOpenResultSchema = z.object({
  opened: z.boolean(),
  error: z.string().optional(),
});
export type SparkRulesOpenResult = z.infer<typeof sparkRulesOpenResultSchema>;

export const sparkRuleRefusalSchema = z.object({
  group: sparkRuleGroupSchema,
  prefix: z.string(),
});
export type SparkRuleRefusal = z.infer<typeof sparkRuleRefusalSchema>;

export const sparkRuleAnswerSchema = z.enum(['allow_group', 'allow_once', 'keep']);
export type SparkRuleAnswer = z.infer<typeof sparkRuleAnswerSchema>;

export const sparkRuleAnswerRequestSchema = z.object({ answer: sparkRuleAnswerSchema });
export type SparkRuleAnswerRequest = z.infer<typeof sparkRuleAnswerRequestSchema>;

export function sparkRuleGroupLabel(group: SparkRuleGroup): string {
  return group === 'workflows' ? 'Run a workflow' : 'Other commands';
}

export function allowGroupLabel(rule: SparkRuleRefusal): string {
  return rule.group === 'workflows'
    ? 'Allow workflows and retry'
    : `Allow ${rule.prefix} and retry`;
}

export function sparkRuleLine(rule: SparkRuleRefusal): string {
  return rule.group === 'workflows'
    ? 'running workflows is off in Spark rules'
    : `${rule.prefix} isn't an allowed command in Spark rules`;
}
