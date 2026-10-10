import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import {
  NO_RUN_RULES,
  SAFE_READ_WHY,
  decide,
  type ApprovalRequest,
  type DecideOptions,
} from './decide.ts';
import type { FileLister } from './file-lister.ts';
import { parseShell } from './shell-parse.ts';

const WEB = '/work/feature-web';
const DASHBOARDS = '/work/feature-dashboards';
const WHY = 'Bypass permissions mode';
const noFiles: FileLister = { glob: () => [], walk: () => [], script: () => null };

function run(command: string): ApprovalRequest {
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title: command,
    command,
    cwd: WEB,
    paths: [],
    diffs: [],
    options: [],
    roots: [
      { path: WEB, ignore: [] },
      { path: DASHBOARDS, ignore: ['private/'] },
    ],
    home: '/Users/me',
  };
}

async function planning(
  command: string,
  options: DecideOptions = {},
  posture: ModePosture = 'read_only',
) {
  const shell = await parseShell(command);
  return decide(posture, run(command), NO_RUN_RULES, [], {
    files: noFiles,
    builder: true,
    planningWhy: WHY,
    ...options,
    shell,
  });
}

const ran = { verdict: 'allow', by: 'level', why: WHY };

const UNPROVEN_READS = [
  `cd ${DASHBOARDS} && sed -n 80,200p README.md; for f in docs/*.md; do echo "== $f"; sed -n 1,20p "$f"; done`,
  'for f in src/common/dashboards/dashboard/*.py; do sed -n 1,40p "$f"; done',
  `grep -rn -E "useAnalyticsQuery|useAnalyticsCatalog" libs apps --include='*.ts' | head -40`,
  'sed -n 165,195p apps/web/src/config/navigation-registry.ts; grep -rn "dynamicDashboards" libs',
  'pnpm test',
];

describe('decide() while the agent plans in a chat whose mode runs without asking', () => {
  it.each(UNPROVEN_READS)('runs %s', async (command) => {
    expect(await planning(command)).toEqual(ran);
    expect(await planning(command, { agentAsks: true })).toEqual(ran);
  });

  it.each(UNPROVEN_READS)('asks about %s when the chat mode asks', async (command) => {
    expect(await planning(command, { planningWhy: null })).toMatchObject({ verdict: 'ask' });
    expect(await planning(command, { planningWhy: null, agentAsks: true })).toMatchObject({
      verdict: 'ask',
    });
  });

  it('keeps the reason of a read it can prove', async () => {
    expect(await planning('sed -n 1,40p README.md')).toEqual({
      verdict: 'allow',
      by: 'level',
      why: SAFE_READ_WHY,
    });
  });

  it.each([
    'touch notes.txt',
    'mkdir out',
    'ls > listing.txt',
    'pnpm install',
    'git commit -am wip',
    'f() { ls; }; f',
  ])('still asks before %s', async (command) => {
    expect(await planning(command)).toEqual({ verdict: 'ask', reason: null });
    expect(await planning(command, { agentAsks: true })).toEqual({ verdict: 'ask', reason: null });
  });

  it.each([
    ['a changed secret file', `sed -i '' 's/a/b/' .env`, /secret file/],
    ['a read .sparkignore lists', `cat ${DASHBOARDS}/private/notes.md`, /\.sparkignore lists/],
    ['a delete outside the linked repos', 'rm -rf /Users/me/Documents/x', /outside this project/],
    ['a write outside the linked repos', 'cp a.ts /Users/me/Desktop/a.ts', /outside/],
    ['a changed instruction file', 'echo x >> AGENTS.md', /instruction files/],
    ['a changed git hook', 'echo x > .git/hooks/pre-commit', /hooks and settings/],
  ])('keeps the card for %s', async (_name, command, reason) => {
    expect(await planning(command)).toEqual(
      expect.objectContaining({ verdict: 'ask', reason: expect.stringMatching(reason) }),
    );
  });

  it.each(['git push --force origin main', 'git push origin main', 'gh pr merge 4'])(
    'keeps refusing %s for a Builder',
    async (command) => {
      expect((await planning(command)).verdict).toBe('reject');
    },
  );

  it('asks before a push when no publish rule covers it', async () => {
    expect(await planning('git push origin spark/x', { builder: false })).toMatchObject({
      verdict: 'ask',
    });
  });
});
