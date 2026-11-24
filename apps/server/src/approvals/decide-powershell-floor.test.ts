import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import {
  NO_RUN_RULES,
  POWERSHELL_REASON,
  RUN_REJECTED_REASON,
  decide,
  ruleFor,
  type ApprovalRequest,
  type DecideOptions,
} from './decide.ts';
import type { FileLister } from './file-lister.ts';
import { toGatePath } from './gate-path.ts';
import { readCodexCommand, readPowerShell } from './powershell-read.ts';
import type { PublishGrant, TaskBranch } from './publish-policy.ts';
import { parseShell } from './shell-parse.ts';
import { recommendedRulesText, userRules } from '../spark-rules/recommended.ts';
import { NO_SPARK_RULES } from '../spark-rules/resolve.ts';

const ROOT = '/c/work/app';
const BRANCH = 'spark/fix-dates-1a2b';
const TASK: TaskBranch = { branch: BRANCH, protectedBranches: ['main', 'master'], pull: 12 };
const files: FileLister = { glob: () => [], walk: () => [], script: () => null };
const GRANTS: PublishGrant[] = [
  { level: 'hands-off', requested: false },
  { level: 'hands-off', requested: true },
  { level: 'full-auto', requested: false },
];
const POSTURES: ModePosture[] = ['asks', 'edits', 'auto', 'full_access', 'read_only', 'unknown'];
const RECOMMENDED = {
  rules: userRules(recommendedRulesText({ workflows: 'refused', ghAllowed: [] })),
  once: [],
};
const RULES = [RECOMMENDED, { rules: NO_SPARK_RULES, once: [] }];
const TEMP = toGatePath(tmpdir(), 'win32');

function wrap(script: string): string {
  return `pwsh -NoProfile -c '${script.replaceAll("'", `'"'"'`)}'`;
}

function run(command: string): ApprovalRequest {
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title: command,
    command,
    cwd: ROOT,
    paths: [],
    diffs: [],
    options: [],
    roots: [{ path: ROOT, ignore: [] }],
    home: '/c/Users/me',
  };
}

async function viaPowerShell(posture: ModePosture, command: string, options: DecideOptions) {
  const readAs = await readPowerShell(wrap(command));
  expect(readAs, command).not.toBeNull();
  const shell = await parseShell(readAs);
  return decide(posture, run(command), NO_RUN_RULES, [], { ...options, readAs, shell });
}

async function viaBash(posture: ModePosture, command: string, options: DecideOptions) {
  const shell = await parseShell(command);
  return decide(posture, run(command), NO_RUN_RULES, [], { ...options, shell });
}

async function expectParity(powershell: string, bash: string) {
  for (const sparkRules of RULES) {
    for (const grant of GRANTS) {
      for (const posture of POSTURES) {
        const options: DecideOptions = {
          changesProject: true,
          files,
          publish: { grant, task: TASK },
          sparkRules,
        };
        const label = `${powershell} in ${posture}, ${grant.level}`;
        expect(await viaPowerShell(posture, powershell, options), label).toEqual(
          await viaBash(posture, bash, options),
        );
      }
    }
  }
}

describe('Codex PowerShell commands on Windows get the safety floor', () => {
  it.each([
    ['push own branch', `git push origin ${BRANCH}`, `git push origin ${BRANCH}`],
    ['push other branch', 'git push origin main', 'git push origin main'],
    ['force push', `git push -f origin ${BRANCH}`, `git push -f origin ${BRANCH}`],
    [
      'gh pr create',
      `gh pr create --title "Fix it" --body 'It''s fixed'`,
      `gh pr create --title 'Fix it' --body "It's fixed"`,
    ],
    ['gh pr merge', 'gh pr merge 12 --squash', 'gh pr merge 12 --squash'],
    ['gh pr review', 'gh pr review 12 --approve', 'gh pr review 12 --approve'],
    [
      'gh api write',
      'gh api -X POST repos/acme/app/issues -f title=x',
      'gh api -X POST repos/acme/app/issues -f title=x',
    ],
    ['secret file write', "Set-Content -Path .env -Value 'A=1'", 'echo > .env'],
    ['secret file append', 'Add-Content .env B=2', 'echo >> .env'],
    [
      'secret file delete',
      'Remove-Item -Force C:\\work\\app\\.env.local',
      'rm -f /c/work/app/.env.local',
    ],
    [
      'secret file copy out',
      'Copy-Item .env C:\\Users\\me\\leak.txt',
      'cp .env /c/Users/me/leak.txt',
    ],
    ['write outside', 'Set-Content ..\\outside.txt hi', 'echo hi > ../outside.txt'],
    ['redirect outside', "echo hi > 'C:\\srv\\notes.txt'", 'echo hi > /c/srv/notes.txt'],
    ['delete outside', 'Remove-Item -Recurse C:\\srv\\other', 'rm -rf /c/srv/other'],
    ['temp folder write', 'Set-Content "$env:TEMP\\x.txt" hi', `echo hi > ${TEMP}/x.txt`],
    ['git config', 'git config core.hooksPath hooks', 'git config core.hooksPath hooks'],
    ['git hook write', 'Set-Content .git\\hooks\\pre-commit x', 'echo x > .git/hooks/pre-commit'],
    ['instruction file', 'Write-Output hi | Out-File AGENTS.md', 'echo hi > AGENTS.md'],
    ['read only', 'Get-Content src\\a.ts', 'cat src/a.ts'],
  ])('decides %s as the bash command', async (_name, powershell, bash) => {
    await expectParity(powershell, bash);
  });

  it('asks before the floor cases it reads', async () => {
    const options: DecideOptions = {
      changesProject: true,
      files,
      publish: { grant: GRANTS[0]!, task: TASK },
      sparkRules: RECOMMENDED,
    };
    const forced = await viaPowerShell(
      'auto',
      `git push --force-with-lease origin ${BRANCH}`,
      options,
    );
    expect(forced).toMatchObject({ verdict: 'ask', forcePush: [BRANCH] });
    const secret = await viaPowerShell('auto', 'Remove-Item .env', options);
    expect(secret).toMatchObject({ verdict: 'ask', secretFiles: ['.env'] });
    const outside = await viaPowerShell('auto', 'Set-Content ..\\outside.txt hi', options);
    expect(outside).toMatchObject({ verdict: 'ask', outsideWrite: true });
    const hooks = await viaPowerShell('auto', 'git config core.hooksPath x', options);
    expect(hooks.verdict).toBe('ask');
    const merge = await viaPowerShell('full_access', 'gh pr merge 12', options);
    expect(merge.verdict).toBe('reject');
    const other = await viaPowerShell('full_access', 'git push origin main', options);
    expect(other.verdict).toBe('reject');
  });

  it('matches run rules against the command as Codex sent it', async () => {
    const command = 'Remove-Item -Recurse build';
    const readAs = await readPowerShell(wrap(command));
    const rules = { allow: [], reject: [ruleFor(run(command))!] };
    expect(
      decide('auto', run(command), rules, [], { files, readAs, shell: await parseShell(readAs) }),
    ).toEqual({ verdict: 'reject', reason: RUN_REJECTED_REASON });
  });
});

async function gated(posture: ModePosture, command: string, extra: DecideOptions = {}) {
  const reading = await readCodexCommand(run(wrap(command)), true);
  const shell = await parseShell(reading.readAs ?? command);
  return decide(posture, reading.request, NO_RUN_RULES, [], {
    changesProject: true,
    files,
    publish: { grant: GRANTS[0]!, task: TASK },
    sparkRules: RECOMMENDED,
    shell,
    powershell: reading.unreadable,
    readAs: reading.readAs,
    ...extra,
  });
}

const STILL_ASKS = { verdict: 'ask', reason: POWERSHELL_REASON };

describe('PowerShell spellings the reader refuses keep asking', () => {
  it.each([
    'git push\u0085--force origin spark/fix-1',
    'git config\u0085core.hooksPath x',
    'Set-Content .git\\hooks\\pre-commit\u0085x',
    "git '' push --force origin main",
    `git push origin ${BRANCH} '--push-option=a b" main "--push-option=c'`,
    'Set-Content AGENTS.md. x',
    "Set-Content 'AGENTS.md ' x",
    'Set-Content .git.\\hooks\\pre-commit x',
    'Set-Content AGENTS~1.MD x',
    "Remove-Item '.e*'",
    "Set-Content '[.]env' x",
    "Set-Content 'AGENTS.m?' x",
    "echo x > 'AGENTS.m?'",
    'Remove-Item -Recurse .git\\hoo*',
    'git status > /dev/null',
  ])('asks in full access: %s', async (command) => {
    expect(await gated('full_access', command)).toEqual(STILL_ASKS);
  });

  it.each(['git p\\ush origin main', 'echo x > AGENTS.m\\d'])(
    'asks before a bash script Codex sent without PowerShell: %s',
    async (command) => {
      const reading = await readCodexCommand(run(command), true);
      expect(reading).toMatchObject({ readAs: null, unreadable: true });
      const decision = decide('full_access', reading.request, NO_RUN_RULES, [], {
        changesProject: true,
        files,
        publish: { grant: GRANTS[0]!, task: TASK },
        sparkRules: RECOMMENDED,
        shell: await parseShell(command),
        powershell: true,
      });
      expect(decision.verdict).not.toBe('allow');
    },
  );

  it('refuses browser data reached through a trailing dot', async () => {
    const command = 'Get-Content C:\\Users\\me\\AppData\\Spark.\\Cookies';
    const browserData = '/c/Users/me/AppData/Spark';
    expect(await gated('full_access', command, { browserData })).toEqual(STILL_ASKS);
  });
});

describe('PowerShell paths on Windows match protected files in any letter case', () => {
  const platform = process.platform;
  afterEach(() => Object.defineProperty(process, 'platform', { value: platform }));

  it.each([
    ['Set-Content agents.MD x', 'instructionFiles'],
    ['Set-Content .GIT\\hooks\\pre-commit x', 'gitControl'],
    ['Set-Content .git\\HOOKS\\pre-commit x', 'gitControl'],
    ['Set-Content .git\\Config x', 'gitControl'],
  ])('asks before %s', async (command, field) => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const decision = await gated('full_access', command);
    expect(decision.verdict).toBe('ask');
    expect(decision).toHaveProperty(field);
  });

  it('refuses browser data in another letter case', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const command = 'Get-Content C:\\Users\\me\\AppData\\SPARK\\cookies';
    const browserData = '/c/Users/me/AppData/Spark';
    expect((await gated('full_access', command, { browserData })).verdict).toBe('reject');
  });
});
