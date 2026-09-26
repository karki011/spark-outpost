import { z } from 'zod';

export const CHECK_COMMANDS_MAX = 5;
export const CHECK_COMMAND_MAX_LENGTH = 300;
export const CHECK_OUTPUT_TAIL_BYTES = 8 * 1024;

export const checkCommandsSchema = z
  .array(z.string().trim().min(1).max(CHECK_COMMAND_MAX_LENGTH))
  .max(CHECK_COMMANDS_MAX);

export const checkKindSchema = z.enum(['typecheck', 'lint', 'test', 'custom']);
export type CheckKind = z.infer<typeof checkKindSchema>;

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
});
export type CheckBody = z.infer<typeof checkBodySchema>;

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function resultPhrase(result: CheckResult): string {
  if (result.outcome === 'passed')
    return `${result.command} passed in ${seconds(result.durationMs)}`;
  if (result.outcome === 'timed_out') return `${result.command} timed out`;
  if (result.outcome === 'denied') return `${result.command} was not allowed`;
  if (result.outcome === 'skipped') return `${result.command} skipped`;
  return `${result.command} exited ${result.exitCode ?? 'with an error'}`;
}

export function checkLine(body: CheckBody): string {
  const failing = body.results.filter((result) => result.outcome !== 'passed');
  const shown = body.status === 'passed' ? body.results : failing;
  const phrases = shown.map(resultPhrase).join(', ');
  const who = body.copy ? `${body.name}'s copy` : body.name;
  const verb =
    body.status === 'passed'
      ? 'Checks passed'
      : body.status === 'failed'
        ? 'Checks failed'
        : 'Checks skipped';
  return `${verb} for ${who}: ${phrases}`;
}

export function failingChecks(body: CheckBody): CheckResult[] {
  return body.results.filter(
    (result) => result.outcome === 'failed' || result.outcome === 'timed_out',
  );
}
