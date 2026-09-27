import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { verifyScenario } from './repo.ts';
import { renderReport } from './report.ts';
import type { E2eRun } from './results.ts';
import { scenarioById } from './scenarios.ts';

const { values } = parseArgs({
  options: {
    results: { type: 'string' },
    scenarios: { type: 'string', default: '' },
    drop: { type: 'string', default: '' },
  },
});

const VALID_BEFORE = {
  suite: { tests: 1, pass: 1, fail: 0 },
  hidden: { tests: 1, pass: 0, fail: 1 },
};

async function main(): Promise<void> {
  if (!values.results) throw new Error('Pass --results with a results JSON file.');
  const run = JSON.parse(await readFile(values.results, 'utf8')) as E2eRun;
  const rescore = values.scenarios.split(',').filter(Boolean);
  for (const cell of run.cells.filter((candidate) => rescore.includes(candidate.scenario))) {
    const task = scenarioById(cell.scenario).task;
    const verification = await verifyScenario(
      task,
      {
        repo: { path: cell.repo, base: await baseOf(cell.repo) },
        before: VALID_BEFORE,
        deps: cell.deps,
      },
      { reply: cell.turns.at(-1)?.metrics.reply ?? '', asked: cell.asked, cleanup: cell.cleanup },
    );
    cell.verification = verification;
    cell.passed = verification.passed && cell.error === null;
    console.log(`${cell.key} #${cell.repeat}: ${cell.passed ? 'pass' : 'fail'}`);
  }
  const drop = values.drop.split(',').filter(Boolean);
  const dropped = run.cells.filter((cell) => drop.includes(`${cell.key}#${cell.repeat}`));
  run.cells = run.cells.filter((cell) => !dropped.includes(cell));
  for (const cell of dropped)
    console.log(`dropped ${cell.key} #${cell.repeat} ($${cell.costUsd.toFixed(3)})`);
  await writeFile(values.results, `${JSON.stringify(run, null, 2)}\n`);
  await writeFile(values.results.replace(/\.json$/, '.md'), renderReport(run));
}

async function baseOf(repo: string): Promise<string> {
  const args = [
    '-C',
    repo,
    'log',
    '-1',
    '--format=%H',
    '-E',
    '--grep=^(Fixture|Add dependencies)$',
  ];
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

await main();
