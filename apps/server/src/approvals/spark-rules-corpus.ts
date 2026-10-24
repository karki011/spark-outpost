import type { ModePosture } from '@spark-outpost/contracts';
import type { ApprovalRequest, DecideOptions } from './decide.ts';
import type { FileLister } from './file-lister.ts';
import type { PublishGrant, TaskBranch } from './publish-policy.ts';

const ROOT = '/work/app/.spark/worktrees/chat-1';
const HOME = '/Users/me';
const BRANCH = 'spark/fix-dates-1a2b';
const TASK: TaskBranch = { branch: BRANCH, protectedBranches: ['main', 'master'], pull: 12 };
const FILES: FileLister = { glob: () => [], walk: () => [], script: () => null };

export const CORPUS_POSTURES: readonly ModePosture[] = [
  'asks',
  'edits',
  'auto',
  'full_access',
  'denies',
  'read_only',
];

const GRANTS: Readonly<Record<string, PublishGrant>> = {
  unasked: { level: 'hands-off', requested: false },
  asked: { level: 'hands-off', requested: true },
  fullAuto: { level: 'full-auto', requested: false },
};

export interface CorpusCase {
  name: string;
  request: ApprovalRequest;
  options: DecideOptions;
}

function base(title: string): ApprovalRequest {
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title,
    command: null,
    cwd: ROOT,
    paths: [],
    diffs: [],
    options: [],
    roots: [{ path: ROOT, ignore: ['private/**'] }],
    home: HOME,
  };
}

function command(text: string): ApprovalRequest {
  return { ...base(text), command: text };
}

function edit(target: string): ApprovalRequest {
  return { ...base(`Edit ${target}`), kind: 'edit', toolKind: 'edit', paths: [target] };
}

const COMMANDS = [
  `git push origin ${BRANCH}`,
  'git push -u origin HEAD',
  'git push origin main',
  'git push origin spark/someone-else',
  'git push --all origin',
  'git push https://example.net/r.git ' + BRANCH,
  `git push --force-with-lease origin ${BRANCH}`,
  `git push -f origin ${BRANCH}`,
  'git push --force origin main',
  `git push --no-verify origin ${BRANCH}`,
  'gh pr create --fill',
  'gh pr edit 12 --title x',
  'gh pr create --head main --fill',
  `git push origin ${BRANCH} && gh pr create --fill`,
  'gh workflow run ci.yml',
  'gh run rerun 5',
  'gh run cancel 5',
  'gh release create v1.2.0 --notes x',
  'gh issue comment 3 --body x',
  'gh pr comment 12 --body done',
  'gh pr merge 12 --squash',
  'gh pr review 12 --approve',
  'gh pr review 12 --comment --body x',
  'gh api -X POST repos/a/b/issues',
  'gh api repos/a/b/pulls',
  'gh pr view 12',
  'gh pr checks 12',
  'gh auth status',
  'git remote add fork https://example.net/fork.git',
  'git remote set-url origin https://example.net/other.git',
  'git send-email HEAD~1',
  'glab mr create --fill',
  'cat .env',
  'cat private/notes.md',
  'echo x > .env',
  'cp .env /tmp/copy',
  'rm -rf ../other-project',
  'echo hi > ../outside.txt',
  'git config core.hooksPath hooks',
  'git config --global user.name x',
  'npm test',
  'ls -la',
  'sed -n 1,40p src/a.ts',
];

const EDITS = [
  `${ROOT}/src/a.ts`,
  `${ROOT}/.env`,
  `${ROOT}/AGENTS.md`,
  `${ROOT}/.claude/settings.json`,
  `${ROOT}/.git/hooks/pre-commit`,
  `${ROOT}/.git/config`,
  `${HOME}/elsewhere.txt`,
];

function withGrants(name: string, request: ApprovalRequest): CorpusCase[] {
  const cases = Object.entries(GRANTS).map(([grant, publish]) => ({
    name: `${name} [${grant}]`,
    request,
    options: { changesProject: true, files: FILES, publish: { grant: publish, task: TASK } },
  }));
  const noTask: CorpusCase = {
    name: `${name} [no task]`,
    request,
    options: { changesProject: true, files: FILES, publish: { grant: GRANTS.asked!, task: null } },
  };
  return [...cases, noTask];
}

export function corpusCases(): CorpusCase[] {
  const sent: CorpusCase = {
    name: 'push holding a secret value [asked]',
    request: command(`git push origin ${BRANCH}`),
    options: {
      changesProject: true,
      files: FILES,
      secretSend: { kind: 'found', files: ['.env'] },
      publish: { grant: GRANTS.asked!, task: TASK },
    },
  };
  return [
    ...COMMANDS.flatMap((text) => withGrants(text, command(text))),
    ...EDITS.flatMap((target) => withGrants(`edit ${target}`, edit(target))),
    sent,
  ];
}
