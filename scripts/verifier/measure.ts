import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { askSystemOne, jevUsage, JEV_LATEST } from '../../apps/server/src/advisor/jev.ts';
import {
  buildVerdictQuestions,
  readVerdict,
  requirementLines,
  type VerdictReading,
} from '../../apps/server/src/advisor/verify-questions.ts';
import { criticPrompt } from '../../apps/server/src/orchestration/context.ts';
import { reviewVerdict } from '../../apps/server/src/orchestration/review.ts';
import { keychainSecretStore } from '../../apps/server/src/setup/secrets.ts';
import type { Variant, VerifierCase } from './case.ts';
import { LEDGER_TASKS } from './cases-ledger.ts';
import { MONEY_TASKS } from './cases-money.ts';
import { CHECK_COMMAND, prepareCase, type PreparedCase } from './repo.ts';
import { summarise } from './score.ts';

const TASKS = [...MONEY_TASKS, ...LEDGER_TASKS];
const CASES: VerifierCase[] = TASKS.flatMap((task) => [
  { task, variant: 'wrong' as const },
  { task, variant: 'correct' as const },
]);

export interface CaseResult {
  id: string;
  variant: Variant;
  visible: boolean;
  hidden: boolean;
  jev: (VerdictReading & { inputTokens: number; costUsd: number; model: string }) | null;
  jevError: string | null;
  critic: { verdict: string; costUsd: number; text: string } | null;
}

const CHECKS = [`- \`${CHECK_COMMAND}\` passed`];

async function askJev(apiKey: string, item: VerifierCase, prepared: PreparedCase) {
  const requirements = requirementLines(item.task.prompt);
  const asked = buildVerdictQuestions({
    request: item.task.prompt,
    plan: [],
    requirements,
    diff: prepared.diff,
    checks: CHECKS,
  });
  const response = await askSystemOne(
    {
      baseUrl: process.env.TYPESAFE_BASE_URL ?? 'https://api.typesafe.ai',
      apiKey,
      model: JEV_LATEST,
      fetch,
      timeoutMs: 20_000,
    },
    asked,
    new AbortController().signal,
  );
  const usage = jevUsage(asked, response);
  return {
    ...readVerdict(requirements, response),
    inputTokens: usage.inputTokens,
    costUsd: usage.costUsd,
    model: response.model,
  };
}

function askCritic(item: VerifierCase, prepared: PreparedCase) {
  const prompt = criticPrompt({
    request: item.task.prompt,
    plan: [],
    changes: prepared.files,
    patch: prepared.diff,
    checks: CHECKS,
  });
  const run = spawnSync(
    'claude',
    [
      '-p',
      '--model',
      'sonnet',
      '--output-format',
      'json',
      '--tools',
      '',
      '--no-session-persistence',
      '--strict-mcp-config',
      '--system-prompt',
      'You are a careful code reviewer. You cannot run code; judge from the text given.',
    ],
    { cwd: prepared.repo, input: prompt, encoding: 'utf8', timeout: 180_000 },
  );
  const parsed = JSON.parse(run.stdout) as { result: string; total_cost_usd: number };
  return {
    verdict: reviewVerdict(parsed.result),
    costUsd: parsed.total_cost_usd,
    text: parsed.result,
  };
}

async function main(): Promise<void> {
  const withCritic = process.argv.includes('--critic');
  const out = process.argv.find((arg) => arg.endsWith('.json'));
  const apiKey = await keychainSecretStore().get('jev');
  if (!apiKey) throw new Error('No Jev key in the keychain.');
  const root = await mkdtemp(join(tmpdir(), 'verifier-set-'));
  const results: CaseResult[] = [];
  for (const item of CASES) {
    const prepared = await prepareCase(root, item);
    const expectedHidden = item.variant === 'correct';
    if (!prepared.visible || prepared.hidden !== expectedHidden) {
      throw new Error(
        `${item.task.id} ${item.variant}: visible ${prepared.visible}, hidden ${prepared.hidden}`,
      );
    }
    let jev: CaseResult['jev'] = null;
    let jevError: string | null = null;
    try {
      jev = await askJev(apiKey, item, prepared);
    } catch (error) {
      jevError = error instanceof Error ? error.message : String(error);
    }
    const critic = withCritic ? askCritic(item, prepared) : null;
    results.push({
      id: item.task.id,
      variant: item.variant,
      visible: prepared.visible,
      hidden: prepared.hidden,
      jev,
      jevError,
      critic,
    });
    console.log(
      `${item.task.id.padEnd(26)} ${item.variant.padEnd(8)} jev ${jev?.verdict ?? 'error'} ${jev?.confidence?.toFixed(2) ?? '-'} reasons ${jev?.reasons.length ?? '-'}${critic ? ` critic ${critic.verdict} $${critic.costUsd.toFixed(3)}` : ''}`,
    );
  }
  console.log(summarise(results));
  if (out) await writeFile(out, `${JSON.stringify(results, null, 2)}\n`);
}

if (process.argv[1]?.endsWith('measure.ts')) await main();
