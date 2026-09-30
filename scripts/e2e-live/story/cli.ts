import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { STUB_URL } from '../config.ts';
import { startGitHubStub } from '../dev-day/github-stub.ts';
import { DEFAULT_RATES } from '../dev-day/score.ts';
import { assertScratchDir } from '../repo.ts';
import { answers, ROOT, startProcess, stopProcess, waitFor, type Runtime } from '../stack.ts';
import { parseArms } from './arms.ts';
import { mergeRuns } from './merge.ts';
import { runStory, STORY_HARD_CAP_USD, type StoryOptions } from './run-story.ts';
import { storySelfTest } from './selftest.ts';

const { values } = parseArgs({
  options: {
    live: { type: 'boolean', default: false },
    dir: { type: 'string' },
    label: { type: 'string', default: 'run' },
    arms: { type: 'string', default: 'a,a2,b,c,d,direct' },
    repeats: { type: 'string', default: '3' },
    pr: { type: 'string', default: 'no' },
    budget: { type: 'string', default: '0' },
    'timeout-min': { type: 'string', default: '40' },
    'hourly-usd': { type: 'string', default: String(DEFAULT_RATES.hourlyUsd) },
    'keep-data': { type: 'boolean', default: false },
    selftest: { type: 'boolean', default: false },
    merge: { type: 'string', default: '' },
    out: { type: 'string', default: '' },
  },
});

function prMode(value: string): StoryOptions['pr'] {
  if (value === 'no' || value === 'also' || value === 'only') return value;
  throw new Error('--pr takes no, also or only.');
}

async function jevStub(runtime: Runtime, dir: string) {
  if (runtime !== 'fake') return null;
  const logs = join(dir, 'logs');
  await mkdir(logs, { recursive: true });
  const script = join(ROOT, 'scripts/e2e-live/stub.ts');
  const stub = startProcess('stub', ['--import', 'tsx', script], ROOT, process.env, logs);
  await waitFor(answers(`${STUB_URL}/health`), 'The Jev stub');
  return stub;
}

async function main(): Promise<void> {
  if (values.merge) {
    if (!values.out) throw new Error('Pass --out with the merged JSON path.');
    const merged = await mergeRuns(values.merge.split(','), values.out);
    console.log(`Merged ${merged.records.length} runs, $${merged.spentUsd.toFixed(2)}.`);
    return;
  }
  if (!values.dir) throw new Error('Pass --dir with a scratch folder.');
  const dir = await assertScratchDir(values.dir);
  if (values.selftest) {
    const lines = await storySelfTest(dir);
    for (const line of lines)
      console.log(`${line.ok ? 'OK ' : 'BAD'} ${line.what}: ${line.detail}`);
    if (lines.some((line) => !line.ok)) process.exitCode = 1;
    return;
  }
  const runtime: Runtime = values.live ? 'acp' : 'fake';
  const budgetUsd = Number(values.budget);
  if (runtime === 'acp' && !(budgetUsd > 0)) throw new Error('A live run needs --budget.');
  if (budgetUsd > STORY_HARD_CAP_USD)
    throw new Error(`--budget is capped at $${STORY_HARD_CAP_USD}.`);
  const jev = await jevStub(runtime, dir);
  const stub = await startGitHubStub();
  try {
    await runStory({
      runtime,
      dir,
      label: values.label,
      budgetUsd: budgetUsd > 0 ? budgetUsd : STORY_HARD_CAP_USD,
      timeoutMs: Number(values['timeout-min']) * 60_000,
      arms: parseArms(values.arms),
      repeats: Number(values.repeats),
      pr: prMode(values.pr),
      rates: { ...DEFAULT_RATES, hourlyUsd: Number(values['hourly-usd']) },
      keepData: values['keep-data'],
      stub,
    });
  } finally {
    await stub.close();
    if (jev) await stopProcess(jev.child);
  }
}

await main();
