import { z } from 'zod';

export const CHECK_OUTPUT_TAIL_BYTES = 8 * 1024;

export const checkKindSchema = z.enum(['typecheck', 'lint', 'test', 'custom']);
export type CheckKind = z.infer<typeof checkKindSchema>;

export const checkCauseSchema = z.enum(['change', 'baseline', 'unknown', 'timeout', 'environment']);
export type CheckCause = z.infer<typeof checkCauseSchema>;

export const checkScopeSchema = z.object({ whole: z.string(), label: z.string() });
export const checkBaselineSchema = z.object({
  base: z.string(),
  outcome: z.enum(['passed', 'failed', 'timed_out', 'unavailable']),
  cached: z.boolean(),
  trusted: z.boolean().optional(),
  durationMs: z.number().int().nonnegative(),
  shared: z.array(z.string()),
  added: z.array(z.string()),
});
export type CheckBaseline = z.infer<typeof checkBaselineSchema>;

export const checkResultSchema = z.object({
  command: z.string(),
  kind: checkKindSchema,
  outcome: z.enum(['passed', 'failed', 'timed_out', 'skipped', 'denied']),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().int().nonnegative(),
  outputTail: z.string(),
  truncated: z.boolean(),
  note: z.string().nullable(),
  approvalId: z.uuid().nullable(),
  cause: checkCauseSchema.nullable().optional(),
  scope: checkScopeSchema.nullable().optional(),
  baseline: checkBaselineSchema.nullable().optional(),
  failures: z.array(z.string()).optional(),
  blamed: z.array(z.string()).optional(),
});
export type CheckResult = z.infer<typeof checkResultSchema>;

export const checkStatusSchema = z.enum(['passed', 'failed', 'skipped']);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

export const checkBodySchema = z.object({
  runId: z.uuid(),
  name: z.string(),
  copy: z.string().nullable(),
  round: z.number().int().positive(),
  status: checkStatusSchema,
  results: z.array(checkResultSchema),
  leftForUser: z.boolean().optional(),
});
export type CheckBody = z.infer<typeof checkBodySchema>;

export function checkCause(result: CheckResult): CheckCause | null {
  if (result.outcome === 'timed_out') return 'timeout';
  if (result.outcome !== 'failed') return null;
  return result.cause ?? 'change';
}

const KIND_NAMES: Record<CheckKind, string | null> = {
  typecheck: 'typecheck',
  lint: 'lint',
  test: 'tests',
  custom: null,
};

function checkName(result: CheckResult, results: readonly CheckResult[]): string {
  const name = KIND_NAMES[result.kind];
  const alone = results.filter((other) => other.kind === result.kind).length === 1;
  return name && alone ? name : result.command;
}

function resultPhrase(result: CheckResult, results: readonly CheckResult[]): string {
  const name = checkName(result, results);
  const cause = checkCause(result);
  if (cause === 'change') return `${name} failed`;
  if (cause === 'baseline') return `${name} already failing before this change`;
  if (cause === 'unknown') return `${name} failed before this change or can't tell`;
  if (cause === 'timeout') return `${name} could not finish in time`;
  if (cause === 'environment') return `${name} could not run`;
  if (result.outcome === 'denied') return `${name} not allowed`;
  if (result.outcome === 'skipped') return `${name} skipped`;
  if (!result.scope) return `${name} passed`;
  return `${name} for ${result.scope.label} passed (whole-repo run skipped)`;
}

export const LEFT_FOR_USER = 'left for you: a fix turn did not change what fails';

export function checkLine(body: CheckBody): string {
  const who = body.copy ? `${body.name}'s copy` : body.name;
  const phrases = body.results.map((result) => resultPhrase(result, body.results));
  const left = body.leftForUser ? ` · ${LEFT_FOR_USER}` : '';
  return `Checks for ${who}: ${phrases.join(' · ')}${left}`;
}

export function failingChecks(body: CheckBody): CheckResult[] {
  return body.results.filter((result) => checkCause(result) === 'change');
}

const UNKNOWN_DETAIL =
  'nothing ties this to the change: it fails in files the change does not touch, and no comparable run on the base commit passed';

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function baselineLine(baseline: CheckBaseline): string {
  const ran = baseline.cached ? 'remembered result' : `ran in ${seconds(baseline.durationMs)}`;
  const how = baseline.trusted === false ? `${ran}, not relied on` : ran;
  const base = baseline.base.slice(0, 8);
  if (baseline.outcome === 'unavailable') return `could not compare with ${base}`;
  if (baseline.outcome === 'passed') return `passes before this change (${base}, ${how})`;
  if (baseline.outcome === 'timed_out')
    return `could not finish before this change either (${base})`;
  const same = baseline.shared.length > 0 ? `; same failures: ${baseline.shared.join(', ')}` : '';
  const added =
    baseline.added.length > 0 ? `; new with this change: ${baseline.added.join(', ')}` : '';
  return `also fails before this change (${base}, ${how})${same}${added}`;
}

export function checkDetails(body: CheckBody): string[] {
  return body.results.map((result) => {
    const parts = [`\`${result.command}\``];
    if (result.outcome === 'passed' || result.outcome === 'failed') {
      parts.push(`exit ${result.exitCode ?? '?'} in ${seconds(result.durationMs)}`);
    }
    if (result.outcome === 'timed_out') parts.push(`stopped after ${seconds(result.durationMs)}`);
    if (result.scope) parts.push(`instead of \`${result.scope.whole}\``);
    if (result.baseline) parts.push(baselineLine(result.baseline));
    if (checkCause(result) === 'change' && (result.blamed ?? []).length > 0) {
      parts.push(`from this change: ${result.blamed!.join(', ')}`);
    }
    if (checkCause(result) === 'unknown') parts.push(UNKNOWN_DETAIL);
    if (result.note) parts.push(result.note);
    return parts.join(' · ');
  });
}
