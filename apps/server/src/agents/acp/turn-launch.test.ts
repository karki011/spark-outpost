import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProviderError, type ProviderTurn } from '../../providers/provider.ts';
import { agentDefinitions } from './agents.ts';
import { discardScratch, planLaunch } from './turn-launch.ts';

let dir: string;
let savedTmp: string | undefined;
let savedRules: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spark-turn-launch-'));
  savedTmp = process.env.TMPDIR;
  savedRules = process.env.SPARK_RULES_FILE;
  process.env.TMPDIR = dir;
  process.env.SPARK_RULES_FILE = join(dir, 'settings.json');
});

afterEach(async () => {
  if (savedTmp === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = savedTmp;
  if (savedRules === undefined) delete process.env.SPARK_RULES_FILE;
  else process.env.SPARK_RULES_FILE = savedRules;
  await rm(dir, { recursive: true, force: true });
});

const options = { definition: agentDefinitions.claude, launch: { command: 'x', args: [] } };

function turn(extra: Partial<ProviderTurn> = {}): ProviderTurn {
  return {
    prompt: 'hi',
    history: [],
    settings: { method: 'cli', model: null, modelLabel: null, effort: null },
    signal: new AbortController().signal,
    ...extra,
  } as unknown as ProviderTurn;
}

const scratchFolders = async () =>
  (await readdir(dir)).filter((name) => name.startsWith('spark-outpost-run-'));

describe.skipIf(process.platform === 'win32')('planning a launch', () => {
  it('works in a scratch folder when the turn has no session folder', async () => {
    const plan = await planLaunch(options, turn(), false);
    expect(plan.scratch).not.toBeNull();
    expect(plan.workspace.home).toBe(plan.scratch);
    expect(plan.workspace.cwd).toBe(plan.scratch);
    expect(await scratchFolders()).toHaveLength(1);
    await discardScratch(plan);
    expect(await scratchFolders()).toEqual([]);
  });

  it('makes the session folder and no scratch folder when the turn has one', async () => {
    const workdir = join(dir, 'sessions', 'chat');
    const session = { workdir } as NonNullable<ProviderTurn['session']>;
    const plan = await planLaunch(options, turn({ session }), false);
    expect(plan.scratch).toBeNull();
    expect(plan.workspace.home).toBe(workdir);
    expect(await readdir(join(dir, 'sessions'))).toEqual(['chat']);
    expect(await scratchFolders()).toEqual([]);
  });

  it('fails as before when the project folder is gone and leaves no scratch folder behind', async () => {
    const missing = join(dir, 'no-such-project');
    const failed = planLaunch(options, turn({ projectRoots: [missing] }), false);
    await expect(failed).rejects.toBeInstanceOf(ProviderError);
    await expect(failed).rejects.toThrow(`can't open the project folder ${missing}`);
    expect(await scratchFolders()).toEqual([]);
  });
});
