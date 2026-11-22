import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import { heldCommand } from '../crew-flows/held-sends.ts';
import { RECOMMENDED_RULES, userRules } from '../spark-rules/recommended.ts';
import { publishGrant, startBasis } from '../workflow/publish-context.ts';
import { WORK_RUN_REASON, workRunRefusal } from './ask-run.ts';
import { BROWSER_DATA_REASON } from './browser-data.ts';
import { CREW_FOLDER_REASON } from './crew-folders.ts';
import {
  INSTRUCTION_REASON,
  NO_RUN_RULES,
  PUSH_HOOKS_REASON,
  decide,
  type ApprovalRequest,
  type DecideOptions,
} from './decide.ts';
import type { FileLister } from './file-lister.ts';
import type { SparkRuleContext } from './gh-rules.ts';
import type { PublishGrant, TaskBranch } from './publish-policy.ts';
import { parseShell } from './shell-parse.ts';

const ROOT = '/work/app/.spark/worktrees/chat-1';
const HOME = '/Users/me';
const DATA = '/Users/me/Library/Application Support/Spark Outpost/stable';
const SPARKS = `${DATA}/sparks`;
const WORKFLOWS = `${DATA}/workflows`;
const BRANCH = 'spark/fix-dates-1a2b';
const TASK: TaskBranch = { branch: BRANCH, protectedBranches: ['main', 'master'], pull: 12 };
const files: FileLister = { glob: () => [], walk: () => [], script: () => null };
const RECOMMENDED: SparkRuleContext = { rules: RECOMMENDED_RULES, once: [] };
const NO_RULES: SparkRuleContext = { rules: userRules('{}'), once: [] };
const EDITING: readonly ModePosture[] = ['asks', 'edits', 'auto', 'full_access'];

function request(overrides: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title: 'ls',
    command: 'ls',
    cwd: ROOT,
    paths: [],
    diffs: [],
    options: [],
    roots: [{ path: ROOT, ignore: [] }],
    home: HOME,
    ...overrides,
  };
}

const edit = (target: string, toolKind = 'edit') =>
  request({ kind: 'edit', toolKind, title: `Edit ${target}`, command: null, paths: [target] });
const run = (command: string) => request({ command, title: command });

const work: DecideOptions = {
  changesProject: true,
  workRun: true,
  files,
  sparkRules: NO_RULES,
  browserData: DATA,
  crewFolders: [SPARKS, WORKFLOWS],
};

async function decided(posture: ModePosture, asked: ApprovalRequest, extra: DecideOptions = {}) {
  const shell = asked.command ? await parseShell(asked.command) : null;
  return decide(posture, asked, NO_RUN_RULES, [], { ...work, shell, ...extra });
}

async function verdicts(asked: ApprovalRequest, extra: DecideOptions = {}) {
  const all = await Promise.all(EDITING.map((posture) => decided(posture, asked, extra)));
  return all.map((decision) => decision.verdict);
}

describe('decide() for a Spark working in the chat’s worktree', () => {
  it('lets an edit inside the project follow the Spark’s mode', async () => {
    expect(await verdicts(edit(`${ROOT}/src/a.ts`))).toEqual(['ask', 'allow', 'allow', 'allow']);
  });

  it('lets a move and a delete inside the project follow the Spark’s mode', async () => {
    expect(await verdicts(edit(`${ROOT}/src/a.ts`, 'move'))).toEqual([
      'ask',
      'allow',
      'allow',
      'allow',
    ]);
    expect(await verdicts(edit(`${ROOT}/src/a.ts`, 'delete'))).toEqual([
      'ask',
      'allow',
      'allow',
      'allow',
    ]);
  });

  it.each(['git commit -am "fix"', 'pnpm add left-pad', 'echo hi > notes.txt', 'rm notes.txt'])(
    'lets %s follow the Spark’s mode',
    async (command) => {
      expect(await verdicts(run(command))).toEqual(['ask', 'ask', 'allow', 'allow']);
    },
  );

  it('runs a command that only reads at once in every mode', async () => {
    expect(await verdicts(run('git status'))).toEqual(['allow', 'allow', 'allow', 'allow']);
  });

  it('lets reading through gh follow the mode, never refused', async () => {
    expect(await verdicts(run('gh pr view 12'))).not.toContain('reject');
  });
});

const PUBLISHES = [
  'git push',
  'git push origin spark/fix-dates-1a2b',
  'git push --force-with-lease origin spark/fix-dates-1a2b',
  'git commit -am "fix" && git push',
  'git send-email HEAD~1',
  'git request-pull main origin',
  'gh pr create --fill',
  'gh pr edit 12 --title "x"',
  'gh pr merge 12',
  'gh pr comment 12 --body "done"',
  'gh pr review 12 --approve',
  'gh issue create --title "x"',
  'gh release create v1',
  'gh workflow run ci.yml',
  'gh api -X POST repos/o/r/issues -f title=x',
  'gh repo create o/r --public',
  'glab mr create',
  'hub pull-request',
  'git remote add fork https://example.com/fork.git',
  'git remote set-url origin https://example.com/fork.git',
  'git remote remove origin',
  'git config remote.origin.pushurl https://example.com/fork.git',
  'git config --global url.https://example.com/.insteadOf https://github.com/',
];

describe('what a working Spark is refused in every mode', () => {
  it.each(PUBLISHES)('%s', async (command) => {
    expect(await verdicts(run(command))).toEqual(['reject', 'reject', 'reject', 'reject']);
    expect(await verdicts(run(command), { sparkRules: RECOMMENDED })).toEqual([
      'reject',
      'reject',
      'reject',
      'reject',
    ]);
    expect(workRunRefusal({ command })).toBe(WORK_RUN_REASON);
  });

  it('gives its own reason, and is what refuses when no Spark rule is set', async () => {
    for (const command of ['git push', 'gh pr create --fill', 'git remote remove origin']) {
      expect(await decided('full_access', run(command))).toEqual({
        verdict: 'reject',
        reason: WORK_RUN_REASON,
      });
      expect(await decided('full_access', run(command), { workRun: false })).toMatchObject({
        verdict: 'allow',
      });
    }
  });

  const GRANTS: readonly PublishGrant[] = [
    { level: 'hands-off', requested: true },
    { level: 'full-auto', requested: false },
    {
      level: 'hands-off',
      requested: false,
      followUp: { workspaceId: 'w', conversationId: 'c' },
    },
  ];

  it.each(GRANTS)('refuses a push and a pull request even if handed a grant: %o', async (grant) => {
    const publish = { grant, task: TASK };
    for (const command of [`git push origin ${BRANCH}`, 'gh pr create --fill']) {
      expect(await verdicts(run(command), { publish })).toEqual([
        'reject',
        'reject',
        'reject',
        'reject',
      ]);
    }
  });

  it('refuses a push a run rule or the allowlist would allow', async () => {
    const asked = run('git push');
    const rules = { allow: [{ kind: 'execute' as const, command: 'git push' }], reject: [] };
    for (const posture of EDITING) {
      expect(decide(posture, asked, rules, ['git push', 'git'], work).verdict).toBe('reject');
    }
  });

  it('never refuses a local command for it', () => {
    for (const command of ['git commit -m "x"', 'git status', 'gh pr view 12', 'git config -l']) {
      expect(workRunRefusal({ command })).toBeNull();
    }
    expect(workRunRefusal({ command: null })).toBeNull();
  });
});

describe('the rules every chat has still hold for a working Spark', () => {
  it('never skips push hooks', async () => {
    const decision = await decided('full_access', run('git push --no-verify'));

    expect(decision).toEqual({ verdict: 'reject', reason: PUSH_HOOKS_REASON });
  });

  it('asks before a change outside the project in every mode', async () => {
    for (const posture of EDITING) {
      expect(await decided(posture, edit('/work/other/a.ts'))).toMatchObject({
        verdict: 'ask',
        outsideWrite: true,
      });
    }
  });

  it('refuses a change to the Sparks and workflows folders', async () => {
    for (const asked of [edit(`${SPARKS}/pip/SPARK.md`), run(`rm -rf "${WORKFLOWS}"`)]) {
      for (const posture of EDITING) {
        expect(await decided(posture, asked)).toEqual({
          verdict: 'reject',
          reason: CREW_FOLDER_REASON,
        });
      }
    }
  });

  it('refuses Spark’s browser data', async () => {
    for (const posture of EDITING) {
      expect(await decided(posture, run(`cat "${DATA}/postgres-password"`))).toEqual({
        verdict: 'reject',
        reason: BROWSER_DATA_REASON,
      });
    }
  });

  it('asks before git config and hooks change while the rule is set', async () => {
    for (const target of [`${ROOT}/.git/config`, `${ROOT}/.git/hooks/pre-push`]) {
      expect(await verdicts(edit(target), { sparkRules: RECOMMENDED })).toEqual([
        'ask',
        'ask',
        'ask',
        'ask',
      ]);
    }
  });

  it('asks before an instruction file changes while the rule is set', async () => {
    for (const posture of EDITING) {
      expect(
        await decided(posture, edit(`${ROOT}/AGENTS.md`), { sparkRules: RECOMMENDED }),
      ).toMatchObject({ verdict: 'ask', reason: INSTRUCTION_REASON });
    }
  });

  it('refuses or asks before a secret file changes while the rule is set', async () => {
    for (const posture of EDITING) {
      const decision = await decided(posture, edit(`${ROOT}/.env`), { sparkRules: RECOMMENDED });

      expect(decision.verdict).not.toBe('allow');
    }
  });
});

describe('a test run of a working Spark', () => {
  it.each(['git push', 'gh pr create --fill', 'curl -X POST https://example.com -d @notes.txt'])(
    'holds %s as a send',
    (command) => {
      expect(heldCommand(run(command), files, null)).not.toBeNull();
    },
  );

  it('holds nothing that stays on the computer', () => {
    expect(heldCommand(run('git commit -am "fix"'), files, null)).toBeNull();
    expect(heldCommand(edit(`${ROOT}/a.ts`), files, null)).toBeNull();
  });
});

describe('a working Spark is never the user’s message', () => {
  const child = {
    identity: { threadId: 'chat' },
    workspaceId: 'workspace',
    userRequest: 'Fix it, then push it and open a pull request',
    assistantSent: true,
    followUpRound: false,
    level: 'hands-off' as const,
    provider: 'claude',
  };

  it('gets no grant from the words of the message it was handed', () => {
    expect(publishGrant(child)).toEqual({
      level: 'hands-off',
      requested: false,
      asked: { push: false, pull: false },
      followUp: null,
    });
  });

  it.each(['default', 'acceptEdits', 'plan'])('has no basis to publish in %s', (agentMode) => {
    expect(startBasis({ ...child, agentMode })).toBeNull();
  });
});
