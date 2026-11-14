import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import { decide, NO_RUN_RULES, type ApprovalRequest, type Decision } from '../approvals/decide.ts';
import type { FileLister } from '../approvals/file-lister.ts';
import type { PublishGrant, TaskBranch } from '../approvals/publish-policy.ts';
import type { SecretSend } from '../approvals/secret-send.ts';
import { sparkFloor } from './floor-flags.ts';
import type { SparkRuleSet } from './resolve.ts';
import { FLOOR_RULE_IDS, GH_ANY } from './rule-ids.ts';
import { loadSparkRules, type SparkRulesFiles } from './rules-store.ts';

const DATA = '/Users/me/Library/Application Support/Spark Outpost';
const ROOT = '/work/app/.spark/worktrees/chat-1';
const BRANCH = 'spark/fix-dates-1a2b';
const files: FileLister = { glob: () => [], walk: () => [], script: () => null };
const UNASKED: PublishGrant = { level: 'hands-off', requested: false };
const MANUAL: ModePosture = 'asks';
const UNSEEN: ModePosture[] = ['auto', 'full_access'];
const TASK: TaskBranch = { branch: BRANCH, protectedBranches: ['main'] };

function request(command: string | null, edited?: string): ApprovalRequest {
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: edited ? 'edit' : 'execute',
    toolKind: edited ? 'edit' : 'execute',
    title: command ?? `Edit ${edited}`,
    command,
    cwd: ROOT,
    paths: edited ? [`${ROOT}/${edited}`] : [],
    diffs: [],
    options: [],
    roots: [{ path: ROOT, ignore: ['private/**'] }],
    home: '/Users/me',
  };
}

interface Example {
  rule: string;
  asked: ApprovalRequest;
  manual: Decision['verdict'];
  unseen?: Decision['verdict'];
  task?: TaskBranch;
  secretSend?: SecretSend;
}

const EXAMPLES: Example[] = [
  { rule: 'Push', asked: request(`git push origin ${BRANCH}`), manual: 'ask' },
  { rule: 'Push(other)', asked: request('git push origin main'), manual: 'ask' },
  { rule: 'Push(force)', asked: request(`git push --force origin ${BRANCH}`), manual: 'ask' },
  { rule: 'PullRequest', asked: request('gh pr create --fill'), manual: 'ask' },
  { rule: 'GitRemote', asked: request('git remote add fork https://e.net/f.git'), manual: 'ask' },
  { rule: GH_ANY, asked: request('gh release create v1.2.0 --notes x'), manual: 'ask' },
  { rule: 'Gh(pr merge)', asked: request('gh pr merge 12 --squash'), manual: 'ask' },
  { rule: 'Gh(pr review)', asked: request('gh pr review 12 --approve'), manual: 'ask' },
  { rule: 'GhAdmin', asked: request('gh pr edit 12 --admin'), manual: 'ask' },
  { rule: 'Gh(auth)', asked: request('gh auth logout'), manual: 'ask' },
  {
    rule: 'Gh(api write)',
    asked: request('gh api -X POST repos/o/r/issues -f title=x'),
    manual: 'ask',
  },
  { rule: 'SecretFile(edit)', asked: request(null, '.env'), manual: 'ask' },
  { rule: 'SecretFile(read)', asked: request('cat private/notes.md'), manual: 'allow' },
  { rule: 'InstructionFile(edit)', asked: request(null, 'AGENTS.md'), manual: 'ask' },
  { rule: 'GitConfig', asked: request('git config core.hooksPath hooks'), manual: 'ask' },
  {
    rule: 'WriteOutside',
    asked: request('echo hi > ../outside.txt'),
    manual: 'ask',
    unseen: 'ask',
  },
  {
    rule: 'SecretSend',
    asked: request(`git push origin ${BRANCH}`),
    secretSend: { kind: 'found', files: ['.env'] },
    manual: 'ask',
  },
];

const MORE_FORCE: ApprovalRequest[] = [
  request('git push --force origin main'),
  request('git push --mirror origin'),
  request('git push -f'),
];

function judged(asked: ApprovalRequest, posture: ModePosture, rules: SparkRuleSet, extra = {}) {
  return decide(posture, asked, NO_RUN_RULES, [], {
    changesProject: true,
    files,
    browserData: DATA,
    sparkRules: { rules, once: [] },
    publish: { grant: UNASKED, task: TASK },
    ...extra,
  });
}

let dir: string;
let paths: SparkRulesFiles;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spark-rules-empty-'));
  paths = { user: join(dir, 'spark', 'settings.json'), managed: join(dir, 'managed.json') };
  vi.stubEnv('SPARK_RULES_FILE', `${DATA}/spark/settings.json`);
  vi.stubEnv('SPARK_MANAGED_RULES_FILE', '/Library/Application Support/x/managed.json');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function emptyRules(text: string | null): Promise<SparkRuleSet> {
  if (text !== null) {
    await mkdir(join(dir, 'spark'), { recursive: true });
    await writeFile(paths.user, text);
  }
  const loaded = await loadSparkRules(paths);
  expect(loaded.problems).toEqual([]);
  return loaded.rules;
}

const EMPTY_FILES = [
  ['no file', null],
  ['{}', '{}'],
  ['empty permissions', '{ "permissions": {} }'],
] as const;

describe('with no Spark rules, the agent’s mode decides', () => {
  it('covers every rule id', () => {
    const named = new Set(EXAMPLES.map((example) => example.rule));
    expect([...FLOOR_RULE_IDS, GH_ANY].filter((rule) => !named.has(rule))).toEqual([]);
  });

  it.each(EMPTY_FILES)('%s: Manual asks as the mode does, Auto and Bypass run', async (_, text) => {
    const rules = await emptyRules(text);
    for (const example of EXAMPLES) {
      const extra = example.secretSend ? { secretSend: example.secretSend } : {};
      expect(judged(example.asked, MANUAL, rules, extra).verdict, example.rule).toBe(
        example.manual,
      );
      for (const posture of UNSEEN) {
        expect(judged(example.asked, posture, rules, extra).verdict, example.rule).toBe(
          example.unseen ?? 'allow',
        );
      }
    }
  });

  it('lets a Bypass agent force push any branch, mirror included', async () => {
    const rules = await emptyRules(null);
    for (const asked of MORE_FORCE) {
      expect(judged(asked, 'full_access', rules).verdict, asked.command!).toBe('allow');
    }
  });

  it('turns every agent flag off', async () => {
    expect(sparkFloor(await emptyRules(null))).toEqual({
      secretEdits: false,
      forcePush: false,
      remotes: null,
      instructions: null,
      gitConfig: null,
    });
  });
});

describe('with no Spark rules, what is fixed in v1 still holds', () => {
  const REFUSED = [
    `cat "${DATA}/spark/settings.json"`,
    `cat "${DATA}/postgres-password"`,
    `git push --no-verify origin ${BRANCH}`,
  ];

  it.each(REFUSED)('%s is refused in every mode', async (command) => {
    const rules = await emptyRules(null);
    for (const posture of [MANUAL, ...UNSEEN]) {
      expect(judged(request(command), posture, rules).verdict, posture).toBe('reject');
    }
  });

  it("refuses a push while the parent chat's branch is not on the remote", async () => {
    const rules = await emptyRules(null);
    const stacked: TaskBranch = {
      ...TASK,
      stackBase: { branch: 'spark/parent-1', owner: 'Parent', onRemote: false },
    };
    const asked = request(`git push origin ${BRANCH}`);
    const decision = judged(asked, 'full_access', rules, {
      publish: { grant: UNASKED, task: stacked },
    });
    expect(decision.verdict).toBe('reject');
  });
});
