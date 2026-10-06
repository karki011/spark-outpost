import type * as acp from '@agentclientprotocol/sdk';
import type { RoleTurn } from './fake-acp-roles.ts';

const TRIGGER = /#term=([a-z,]+)(?: (\d{1,4})ms)?/;
export const FAKE_TERMINAL_SECRET = 'ghp_abcdefghijklmnopqrstuvwxyz0123';
export const FAKE_HUGE_LINES = 30_000;

interface FakeCommand {
  command: string;
  chunks: readonly string[];
  exitCode: number;
}

const COMMANDS: Record<string, () => FakeCommand> = {
  pass: () => ({
    command: 'pnpm test',
    chunks: ['RUN v5\n', '\u001b[32m✓\u001b[0m one.test.ts\n', 'Tests 1 passed\n'],
    exitCode: 0,
  }),
  fail: () => ({
    command: 'pnpm lint',
    chunks: ['checking\n', '\u001b[31merror\u001b[0m unused variable\n'],
    exitCode: 2,
  }),
  osc: () => ({
    command: 'cat banner.txt',
    chunks: ['\u001b]0;owned\u0007\u001b]52;c;c3RvbGVu\u0007', '\u001b[6nbanner\n'],
    exitCode: 0,
  }),
  secret: () => ({
    command: 'printenv',
    chunks: [`GITHUB_TOKEN=${FAKE_TERMINAL_SECRET}\n`, 'HOME=/home/x\n'],
    exitCode: 0,
  }),
  huge: () => ({
    command: 'seq 30000',
    chunks: Array.from({ length: FAKE_HUGE_LINES / 100 }, (_, block) =>
      Array.from({ length: 100 }, (_, row) => `row ${block * 100 + row} ${'x'.repeat(40)}\n`).join(
        '',
      ),
    ),
    exitCode: 0,
  }),
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function streamed(turn: RoleTurn, id: string, fake: FakeCommand, gapMs: number) {
  const { command, chunks, exitCode } = fake;
  await turn.update({
    sessionUpdate: 'tool_call',
    toolCallId: id,
    kind: 'execute',
    title: command,
    status: 'in_progress',
    content: [{ type: 'terminal', terminalId: id }],
    rawInput: { command: `/bin/zsh -lc '${command}'`, cwd: turn.cwd },
    _meta: { terminal_info: { cwd: turn.cwd, terminal_id: id } },
  });
  for (const data of chunks) {
    if (gapMs > 0) await sleep(gapMs);
    await turn.update({
      sessionUpdate: 'tool_call_update',
      toolCallId: id,
      _meta: { terminal_output_delta: { data, terminal_id: id } },
    });
  }
  await turn.update({
    sessionUpdate: 'tool_call_update',
    toolCallId: id,
    status: exitCode === 0 ? 'completed' : 'failed',
    rawOutput: { formatted_output: chunks.join(''), exit_code: exitCode },
    _meta: { terminal_exit: { exit_code: exitCode, signal: null, terminal_id: id } },
  });
}

function endContent(fake: FakeCommand): acp.ToolCallContent[] {
  const output = fake.chunks.join('').trimEnd();
  const text =
    fake.exitCode === 0
      ? `\`\`\`console\n${output}\n\`\`\``
      : `\`\`\`\nExit code ${fake.exitCode}\n\n${output}\n\`\`\``;
  return [{ type: 'content', content: { type: 'text', text } }];
}

async function atEnd(turn: RoleTurn, id: string, fake: FakeCommand, gapMs: number) {
  const meta = { claudeCode: { toolName: 'Bash' } };
  await turn.update({
    sessionUpdate: 'tool_call',
    toolCallId: id,
    kind: 'execute',
    title: 'Terminal',
    status: 'pending',
    rawInput: {},
    _meta: meta,
  });
  await turn.update({
    sessionUpdate: 'tool_call_update',
    toolCallId: id,
    kind: 'execute',
    title: fake.command,
    rawInput: { command: fake.command, description: 'Runs the command' },
    content: [{ type: 'content', content: { type: 'text', text: 'Runs the command' } }],
    _meta: meta,
  });
  await sleep(gapMs * fake.chunks.length);
  await turn.update({
    sessionUpdate: 'tool_call_update',
    toolCallId: id,
    status: fake.exitCode === 0 ? 'completed' : 'failed',
    content: endContent(fake),
    rawOutput: fake.chunks.join(''),
    _meta: meta,
  });
}

export async function terminalCommands(turn: RoleTurn): Promise<void> {
  const match = TRIGGER.exec(turn.text);
  if (!match) return;
  const gapMs = match[2] ? Number(match[2]) : 0;
  for (const [index, name] of match[1]!.split(',').entries()) {
    const endOnly = name.startsWith('end');
    const fake = COMMANDS[endOnly ? name.slice(3) : name]?.();
    if (!fake) continue;
    const id = `term-${index}`;
    await (endOnly ? atEnd(turn, id, fake, gapMs) : streamed(turn, id, fake, gapMs));
  }
}
