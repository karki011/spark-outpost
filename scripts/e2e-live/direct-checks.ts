import {
  configuredChecks,
  detectChecks,
  type CheckCommand,
} from '../../apps/server/src/checks/detect.ts';
import { readProjectFiles } from '../../apps/server/src/checks/project-checks.ts';
import { runCheck } from '../../apps/server/src/checks/run-check.ts';
import type { BenchEnv } from '../bench/live.ts';
import { inProcessSession, type DirectTurn } from './direct.ts';

export const MAX_FIX_TURNS = 2;
const OUTPUT_LIMIT = 3_000;

interface Outcome {
  command: string;
  exitCode: number | null;
  tail: string;
  durationMs: number;
}

async function checksFor(repo: string, configured?: readonly string[]): Promise<CheckCommand[]> {
  if (configured) return configuredChecks(configured);
  return detectChecks(await readProjectFiles(repo));
}

async function runAll(repo: string, checks: readonly CheckCommand[]): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const check of checks) {
    const run = await runCheck(check, { root: repo, cwd: repo });
    outcomes.push({
      command: check.command,
      exitCode: run.exitCode,
      tail: run.outputTail,
      durationMs: run.durationMs,
    });
  }
  return outcomes;
}

function line(outcomes: readonly Outcome[], round: number): string {
  const parts = outcomes.map((item) =>
    item.exitCode === 0 ? `${item.command} passed` : `${item.command} exited ${item.exitCode}`,
  );
  return `Round ${round}: ${parts.join(', ') || 'no checks'}`;
}

function followUp(failed: readonly Outcome[]): string {
  const details = failed
    .map((item) => `$ ${item.command} (exit ${item.exitCode})\n${item.tail}`)
    .join('\n\n')
    .slice(-OUTPUT_LIMIT);
  return `The project's checks failed after your change. Fix the cause without undoing what was asked, then reply with what you changed.\n\nFailing checks:\n${details}`;
}

export async function directWithChecks(
  env: BenchEnv,
  repo: string,
  prompts: readonly string[],
  timeoutMs: number,
  configured?: readonly string[],
): Promise<DirectTurn[]> {
  const session = await inProcessSession(env, repo, timeoutMs);
  const checks = await checksFor(repo, configured);
  const turns: DirectTurn[] = [];
  for (const prompt of prompts) {
    let turn = await session.send(prompt);
    turns.push(turn);
    for (let round = 1; round <= MAX_FIX_TURNS + 1; round++) {
      const outcomes = await runAll(repo, checks);
      turn.metrics.checks.push(line(outcomes, round));
      const failed = outcomes.filter((item) => item.exitCode !== 0);
      if (failed.length === 0 || round > MAX_FIX_TURNS) break;
      turn = await session.send(followUp(failed));
      turn.metrics.fixTurns = round;
      turns.push(turn);
    }
  }
  return turns;
}
