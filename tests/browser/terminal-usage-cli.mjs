import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
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
];

if (args[0] === '--version') {
  console.log('2.1.296 (Claude Code usage fixture)');
  process.exit(0);
}
if (args.includes('doctor')) {
  console.log(`Unknown hook event. Valid events: ${EVENTS.join(', ')}`);
  process.exit(0);
}

const valueOf = (flag) => args[args.indexOf(flag) + 1];
const settings = JSON.parse(readFileSync(valueOf('--settings'), 'utf8'));
const command = settings.hooks.UserPromptSubmit[0].hooks[0].command;
const sessionId = valueOf('--session-id');
const folder = path.join(os.tmpdir(), 'spark-terminal-usage-fixture');
mkdirSync(folder, { recursive: true });
const transcript = path.join(folder, `${sessionId}.jsonl`);
const promptId = 'fixture-prompt-1';

const hook = (name, extra = {}) =>
  execFileSync('/bin/sh', ['-c', command], {
    input: JSON.stringify({
      hook_event_name: name,
      session_id: sessionId,
      transcript_path: transcript,
      prompt_id: promptId,
      permission_mode: 'default',
      ...extra,
    }),
  });
const write = (record) => appendFileSync(transcript, `${JSON.stringify(record)}\n`);
const reply = (id, output, cacheRead) => ({
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
      output_tokens_details: { thinking_tokens: 0 },
    },
  },
});
const tool = (name, id, tool_name) =>
  hook(name, { tool_name, tool_use_id: id, tool_input: { command: 'not stored' } });

console.log('Terminal usage fixture. No provider request is made.');
hook('SessionStart');
hook('UserPromptSubmit', { prompt: args.at(-1) });
write({ type: 'user', isSidechain: false, promptId, message: { role: 'user', content: 'x' } });
tool('PreToolUse', 'toolu_fixture_1', 'Bash');
write(reply('msg_fixture_1', 120, 20000));
write(reply('msg_fixture_1', 120, 20000));
tool('PostToolUse', 'toolu_fixture_1', 'Bash');
tool('PreToolUse', 'toolu_fixture_2', 'Read');
tool('PostToolUseFailure', 'toolu_fixture_2', 'Read');
write(reply('msg_fixture_2', 30, 20400));
write({ type: 'system', subtype: 'turn_duration', durationMs: 900 });
hook('Stop');
console.log('Turn finished. Type exit to end the session.');

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() !== 'exit') return;
  const total = {
    type: 'cost-state',
    sessionId,
    totalCostUSD: 0.0321,
    modelUsage: {
      'claude-opus-5-5': { inputTokens: 512, outputTokens: 260, costUSD: 0.032 },
      'claude-haiku-5-5': { inputTokens: 1200, outputTokens: 17, costUSD: 0.0001 },
    },
  };
  write(total);
  write(total);
  process.exit(0);
});
