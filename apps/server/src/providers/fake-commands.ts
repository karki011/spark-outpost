import { setTimeout as delay } from 'node:timers/promises';
import type { ProviderOutput, ProviderTurn } from './provider.ts';

const TRIGGER = /#(terminal|steps)(?:=([a-z,]+))?(?: (\d{1,4})ms)?/;
const THINK = 'think';
const DEFAULT_GAP_MS = 60;
const HUGE_LINES = 40_000;
export const FAKE_COMMAND_SECRET = 'ghp_abcdefghijklmnopqrstuvwxyz0123';

interface FakeCommand {
  command: string;
  description?: string;
  lines: readonly string[];
  exitCode: number;
  live?: boolean;
}

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const PLAIN = '\u001b[0m';

function hugeLines(): string[] {
  return Array.from({ length: HUGE_LINES }, (_, row) => `row ${row} ${'x'.repeat(60)}\n`);
}

const COMMANDS: Record<string, () => FakeCommand> = {
  pass: () => ({
    command: 'pnpm test --filter web',
    lines: [
      'RUN  v5.0.1 apps/web\n',
      `${GREEN}✓${PLAIN} src/chat/turns.test.ts (4 tests)\n`,
      `${GREEN}✓${PLAIN} src/chat/work-log.test.ts (7 tests)\n`,
      `${GREEN}✓${PLAIN} src/chat/run-projection.test.ts (12 tests)\n`,
      'Test Files  3 passed (3)\n',
      'Tests  23 passed (23)\n',
    ],
    exitCode: 0,
  }),
  fail: () => ({
    command: 'pnpm lint',
    lines: [
      'apps/web/src/chat/Thread.tsx\n',
      `  12:7  ${RED}error${PLAIN}  'unused' is assigned a value but never used\n`,
      `${RED}✖ 1 problem (1 error, 0 warnings)${PLAIN}\n`,
    ],
    exitCode: 1,
  }),
  osc: () => ({
    command: 'cat banner.txt',
    lines: [
      '\u001b]0;owned title\u0007',
      '\u001b]52;c;c3RvbGVu\u0007',
      '\u001b]8;;https://evil.example\u0007click\u001b]8;;\u0007\n',
      '\u001b[6n\u001b[c',
      'banner shown\n',
    ],
    exitCode: 0,
  }),
  secret: () => ({
    command: 'printenv',
    lines: [`GITHUB_TOKEN=${FAKE_COMMAND_SECRET}\n`, 'HOME=/Users/demo\n'],
    exitCode: 0,
  }),
  huge: () => ({ command: 'seq 40000', lines: hugeLines(), exitCode: 0 }),
  final: () => ({
    command: 'git status --short',
    lines: [' M apps/web/src/chat/Thread.tsx\n', '?? notes.txt\n'],
    exitCode: 0,
    live: false,
  }),
  hang: () => ({ command: 'pnpm dev', lines: ['ready on http://localhost:5173\n'], exitCode: -1 }),
  fetch: () => ({
    command: 'git fetch origin spark/session-activity && git merge --ff-only FETCH_HEAD',
    description: 'Bring in the remote branch',
    lines: ['Already up to date.\n'],
    exitCode: 0,
  }),
  count: () => ({
    command:
      'python -m scripts.run_query --format json --sql "SELECT org_id, count(*) FROM events"',
    description: 'Count events per org',
    lines: [
      'Traceback (most recent call last):\n',
      '  File "scripts/run_query.py", line 88, in main\n',
      'ClientError: The security token included in the request is expired\n',
    ],
    exitCode: 1,
  }),
  whoami: () => ({
    command: 'aws sts get-caller-identity --query Arn --output text',
    description: 'Check which account the profile uses',
    lines: ['arn:aws:sts::000000000000:assumed-role/Engineering/demo\n'],
    exitCode: 0,
  }),
};

export interface CommandPlan {
  names: string[];
  gapMs: number;
  grouped: boolean;
}

export function commandPlan(prompt: string): CommandPlan | null {
  const match = TRIGGER.exec(prompt);
  if (!match) return null;
  const names = (match[2] ?? 'pass')
    .split(',')
    .filter((name) => name in COMMANDS || name === THINK);
  return {
    names,
    gapMs: match[3] ? Number(match[3]) : DEFAULT_GAP_MS,
    grouped: match[1] === 'steps',
  };
}

async function* runCommand(
  turn: ProviderTurn,
  id: string,
  { command, description, lines, exitCode, live = true }: FakeCommand,
  gapMs: number,
): AsyncGenerator<ProviderOutput> {
  const name = `\`${command}\``;
  const cwd = turn.projectRoots?.[0] ?? null;
  yield { kind: 'step_started', name, tool: true, toolKind: 'execute' };
  yield {
    kind: 'command_started',
    id,
    command,
    ...(description ? { description } : {}),
    cwd,
    live,
  };
  if (!live) {
    await delay(gapMs * lines.length, undefined, { signal: turn.signal });
    yield { kind: 'command_output', id, data: lines.join('') };
  }
  const batch = Math.max(1, Math.ceil(lines.length / 200));
  for (let from = 0; live && from < lines.length; from += batch) {
    await delay(gapMs, undefined, { signal: turn.signal });
    yield { kind: 'command_output', id, data: lines.slice(from, from + batch).join('') };
  }
  if (exitCode < 0) await delay(600_000, undefined, { signal: turn.signal });
  await delay(gapMs, undefined, { signal: turn.signal });
  yield { kind: 'command_finished', id, failed: exitCode !== 0, exitCode: live ? exitCode : null };
  yield { kind: 'step_finished', name, tool: true, toolKind: 'execute' };
}

async function* thinking(turn: ProviderTurn, gapMs: number): AsyncGenerator<ProviderOutput> {
  yield { kind: 'step_started', name: 'Thinking' };
  yield { kind: 'thought_delta', delta: 'The first check passed, so I look at the next one.' };
  await delay(gapMs, undefined, { signal: turn.signal });
  yield { kind: 'step_finished', name: 'Thinking' };
}

export async function* fakeCommandTurn(
  turn: ProviderTurn,
  plan: CommandPlan,
): AsyncGenerator<ProviderOutput> {
  yield { kind: 'text_delta', delta: 'Running the commands now.\n\n' };
  for (const [index, name] of plan.names.entries()) {
    if (name === THINK) {
      yield* thinking(turn, plan.gapMs);
      continue;
    }
    yield* runCommand(turn, `fake-command-${index}`, COMMANDS[name]!(), plan.gapMs);
    if (!plan.grouped) yield { kind: 'text_delta', delta: `Finished ${name}.\n\n` };
  }
  yield { kind: 'text_delta', delta: 'terminal=done' };
}
