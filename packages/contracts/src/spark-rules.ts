import { z } from 'zod';
import { outsideChangeSchema } from './spark-rules-edit.ts';

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

export const ghAllowedSchema = z
  .array(z.string().max(80))
  .max(GH_ALLOWED_MAX)
  .transform((entries) => [...new Set(entries.map(tidyGhPrefix))])
  .refine((entries) => entries.every((entry) => ghPrefixProblem(entry) === null), {
    message: 'Each allowed command is gh and two words, such as gh release create.',
  });

export const ruleStandingSchema = z.enum(['refused', 'asks', 'mode']);
export type RuleStanding = z.infer<typeof ruleStandingSchema>;

export const sparkRulesSchema = z.object({
  workflows: ghRuleChoiceSchema,
  ghAllowed: z.array(z.string()),
  otherCommands: ruleStandingSchema,
  floor: z.array(z.object({ rule: z.string(), standing: ruleStandingSchema })),
  problems: z.array(z.string()).optional(),
  outsideChange: outsideChangeSchema.optional(),
});
export type SparkRules = z.infer<typeof sparkRulesSchema>;

export const updateSparkRulesRequestSchema = z
  .object({
    workflows: ghRuleChoiceSchema.optional(),
    ghAllowed: ghAllowedSchema.optional(),
  })
  .refine((body) => body.workflows !== undefined || body.ghAllowed !== undefined);
export type UpdateSparkRulesRequest = z.input<typeof updateSparkRulesRequestSchema>;

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
