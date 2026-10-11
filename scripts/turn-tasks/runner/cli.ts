import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { portSlot } from '../instance/stack.ts';
import { OUTPUT_ROOT } from '../paths.ts';
import { tasksNamed } from '../tasks/index.ts';
import type { ModeChoice } from '../tasks/types.ts';
import { DEFAULT_EFFORT } from './driver.ts';
import { runThenClose } from './lifecycle.ts';
import { PROVIDER_SETUPS, providerNamed } from './providers.ts';
import { runSession } from './session.ts';
import { startTurnDriver } from './turn-driver.ts';

const { values } = parseArgs({
  options: {
    provider: { type: 'string', default: '' },
    task: { type: 'string', default: '' },
    runs: { type: 'string', default: '1' },
    mode: { type: 'string', default: '' },
    model: { type: 'string', default: '' },
    effort: { type: 'string', default: DEFAULT_EFFORT },
    label: { type: 'string', default: `run-${new Date().toISOString().slice(0, 10)}` },
    live: { type: 'boolean', default: false },
    keep: { type: 'boolean', default: false },
  },
});

function modeNamed(value: string): ModeChoice | null {
  if (value === '') return null;
  if (value !== 'auto' && value !== 'ask') throw new Error('Use --mode auto or ask.');
  return value;
}

if (!values.provider) throw new Error('Name a provider with --provider.');
const provider = providerNamed(values.provider);
const setup = PROVIDER_SETUPS[provider];
const model = values.model || setup.model;
const mode = modeNamed(values.mode);
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) throw new Error('Use --runs with a whole number.');
if (!values.task) throw new Error('Name the tasks with --task, for example --task 1,2,3.');
const tasks = tasksNamed(values.task);

let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
  console.log('Stopping: the current run is cancelled, then the instance is shut down.');
});

console.log(
  values.live
    ? `Live run for ${setup.name} (${model}): real, paid calls through ${setup.signIn}.`
    : `Dry run for ${setup.name}: Spark's fake agent, no provider call.`,
);

const code = await runThenClose({
  start: () =>
    startTurnDriver({
      provider,
      model,
      effort: values.effort,
      live: values.live,
      slot: portSlot(),
      dir: join(OUTPUT_ROOT, 'stacks', `${values.label}-${provider}`),
    }),
  work: async (driver) => {
    const plan = { label: values.label, runs, live: values.live, keep: values.keep, tasks, mode };
    await runSession(driver, plan, { log: console.log, stopping: () => stopping });
  },
  log: console.error,
});
process.exit(code);
