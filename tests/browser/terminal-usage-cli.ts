import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

const codex = process.argv[2] === 'codex';
const args = process.argv.slice(codex ? 3 : 2);
const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Stop',
  'SessionEnd',
  'Notification',
  'StopFailure',
  'PostToolUseFailure',
  'Elicitation',
  'ElicitationResult',
  'Interrupt',
];
const folder = path.join(os.tmpdir(), 'spark-terminal-usage-fixture');
const lines = createInterface({ input: process.stdin });
const valueOf = (flag: string) => args[args.indexOf(flag) + 1]!;
const write = (file: string, record: unknown) =>
  appendFileSync(file, `${JSON.stringify(record)}\n`);
const sender =
  (command: string, common: Record<string, unknown>) =>
  (name: string, extra: Record<string, unknown> = {}) =>
    execFileSync('/bin/sh', ['-c', command], {
      input: JSON.stringify({ hook_event_name: name, ...common, ...extra }),
    });
const call = (tool_name: string, tool_use_id: string) => ({
  tool_name,
  tool_use_id,
  tool_input: { command: 'not stored' },
});

function answerProbe() {
  lines.on('line', (line) => {
    const { id } = JSON.parse(line) as { id?: number };
    const hooks = EVENTS.map((eventName) => ({ source: 'sessionFlags', enabled: true, eventName }));
    if (id === 1) console.log(JSON.stringify({ id, result: {} }));
    if (id === 2) console.log(JSON.stringify({ id, result: { data: [{ hooks, errors: [] }] } }));
  });
}

function claudeTurn() {
  const settings = JSON.parse(readFileSync(valueOf('--settings'), 'utf8')) as {
    hooks: Record<string, { hooks: { command: string }[] }[]>;
  };
  const sessionId = valueOf('--session-id');
  const file = path.join(folder, `${sessionId}.jsonl`);
  const promptId = 'fixture-prompt-1';
  const hook = sender(settings.hooks.UserPromptSubmit![0]!.hooks[0]!.command, {
    session_id: sessionId,
    transcript_path: file,
    prompt_id: promptId,
    permission_mode: 'default',
  });
  const reply = (id: string, output: number, cacheRead: number) => ({
    type: 'assistant',
    isSidechain: false,
    message: {
      id,
      model: 'claude-opus-5-5',
      usage: {
        input_tokens: 2,
        output_tokens: output,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: 400,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 400 },
      },
    },
  });
  hook('SessionStart');
  hook('UserPromptSubmit', { prompt: args.at(-1) });
  write(file, { type: 'user', isSidechain: false, promptId, message: { content: 'x' } });
  hook('PreToolUse', call('Bash', 'toolu_fixture_1'));
  write(file, reply('msg_fixture_1', 120, 20000));
  write(file, reply('msg_fixture_1', 120, 20000));
  hook('PostToolUse', call('Bash', 'toolu_fixture_1'));
  hook('PreToolUse', call('Read', 'toolu_fixture_2'));
  hook('PostToolUseFailure', call('Read', 'toolu_fixture_2'));
  write(file, reply('msg_fixture_2', 30, 20400));
  hook('Stop');
  return () => {
    const total = {
      type: 'cost-state',
      sessionId,
      totalCostUSD: 0.0321,
      modelUsage: {
        'claude-opus-5-5': { inputTokens: 512, outputTokens: 260, costUSD: 0.032 },
        'claude-haiku-5-5': { inputTokens: 1200, outputTokens: 17, costUSD: 0.0001 },
      },
    };
    write(file, total);
    write(file, total);
  };
}

function codexTurn() {
  const setting = args.find((arg) => arg.startsWith('hooks.UserPromptSubmit='))!;
  const command = JSON.parse(/"command"=("(?:[^"\\]|\\.)*")/.exec(setting)![1]!) as string;
  const thread = randomUUID();
  const turn = randomUUID();
  const file = path.join(folder, `rollout-2026-10-12T00-00-00-${thread}.jsonl`);
  const hook = sender(command, {
    session_id: thread,
    turn_id: turn,
    transcript_path: file,
    model: 'gpt-5.6-sol',
    permission_mode: 'default',
  });
  const usage = (input: number, cached: number, output: number) => ({
    type: 'token_usage_record',
    payload: {
      thread_id: thread,
      turn_id: turn,
      session_id: thread,
      root_turn_id: turn,
      turn_token_usage: {
        input_tokens: input,
        cached_input_tokens: cached,
        cache_write_input_tokens: 0,
        output_tokens: output,
        reasoning_output_tokens: 0,
        total_tokens: input + output,
      },
    },
  });
  write(file, { type: 'session_meta', payload: { id: thread, session_id: thread } });
  hook('SessionStart');
  hook('UserPromptSubmit', { prompt: args.at(-1) });
  hook('PreToolUse', call('Bash', 'exec-fixture-1'));
  write(file, usage(16852, 7424, 146));
  hook('PostToolUse', call('Bash', 'exec-fixture-1'));
  write(file, usage(33884, 24064, 151));
  hook('Stop');
  return () => undefined;
}

if (args[0] === '--version') {
  console.log(codex ? 'codex-cli 0.157.0-usage-fixture' : '2.1.296 (Claude Code usage fixture)');
  process.exit(0);
} else if (args.includes('doctor')) {
  console.log(`Unknown hook event. Valid events: ${EVENTS.join(', ')}`);
  process.exit(0);
} else if (args.includes('app-server')) {
  answerProbe();
} else {
  mkdirSync(folder, { recursive: true });
  console.log('Terminal usage fixture. No provider request is made.');
  const atExit = codex ? codexTurn() : claudeTurn();
  console.log('Turn finished. Type exit to end the session.');
  lines.on('line', (line) => {
    if (line.trim() !== 'exit') return;
    atExit();
    process.exit(0);
  });
}
