import type * as acp from '@agentclientprotocol/sdk/unstable';
import { diffsTurn } from './fake-acp-diffs.ts';

type Update = (value: acp.SessionUpdate) => Promise<void>;
type Say = (chunk: string) => Promise<void>;

const FAKE_SECRETS = {
  apiKey: 'sk-proj-abcdefghijklmnopqrstuvwx',
  github: 'ghp_abcdefghijklmnopqrstuvwxyz0123',
  envFile: 'PLAIN_VALUE=hello-from-dotenv',
  stderr: 'Bearer abc123def456ghi789',
};

export async function leakSecrets(update: Update, say: Say): Promise<acp.StopReason> {
  process.stderr.write(`auth header ${FAKE_SECRETS.stderr}\n`);
  await update({
    sessionUpdate: 'tool_call',
    toolCallId: 's1',
    title: 'Run printenv',
    kind: 'execute',
    status: 'in_progress',
    rawInput: { command: ['printenv'] },
  });
  await update({
    sessionUpdate: 'tool_call_update',
    toolCallId: 's1',
    status: 'completed',
    rawOutput: { stdout: `OPENAI_API_KEY=${FAKE_SECRETS.apiKey}\nHOME=/home/x`, exitCode: 0 },
    content: [{ type: 'content', content: { type: 'text', text: `token ${FAKE_SECRETS.github}` } }],
  });
  await update({
    sessionUpdate: 'tool_call',
    toolCallId: 's2',
    title: 'Read .env',
    kind: 'read',
    status: 'in_progress',
    rawInput: { file_path: '/work/app/.env' },
  });
  await update({
    sessionUpdate: 'tool_call_update',
    toolCallId: 's2',
    status: 'completed',
    rawOutput: FAKE_SECRETS.envFile,
  });
  await say('done');
  return 'end_turn';
}

const thought = (text: string): acp.SessionUpdate => ({
  sessionUpdate: 'agent_thought_chunk',
  content: { type: 'text', text },
});

const search = (toolCallId: string, query: string): acp.SessionUpdate => ({
  sessionUpdate: 'tool_call',
  toolCallId,
  title: 'Search the docs',
  kind: 'search',
  status: 'in_progress',
  rawInput: { query },
});

const done = (toolCallId: string, text: string): acp.SessionUpdate => ({
  sessionUpdate: 'tool_call_update',
  toolCallId,
  status: 'completed',
  content: [{ type: 'content', content: { type: 'text', text } }],
});

const compacting = (status: string): acp.SessionUpdate => ({
  sessionUpdate: 'compaction_update',
  compactionId: 'compaction-1',
  status,
});

export async function compactionTurn(update: Update, say: Say): Promise<acp.StopReason> {
  await update(compacting('in_progress'));
  await update({
    sessionUpdate: 'compaction_summary_chunk',
    compactionId: 'compaction-1',
    content: { type: 'text', text: 'Summary of the earlier work.' },
  });
  await update(compacting('completed'));
  await update(compacting('completed'));
  await say('Carried on after compacting.');
  return 'end_turn';
}

export async function eventsTurn(
  text: string,
  update: Update,
  say: Say,
  signal: AbortSignal,
): Promise<acp.StopReason> {
  if (text.includes('#diffs')) return diffsTurn(update, say);
  await update(thought('Two searches at once.\n'));
  await update(thought(`The key is ${FAKE_SECRETS.apiKey}\n`));
  await update(search('twin-1', 'steps'));
  await update(search('twin-2', 'tools'));
  await update(done('twin-1', 'steps found'));
  if (text.includes('#hang')) {
    await update(thought('Still waiting on the second search'));
    await new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }
  await update(done('twin-2', 'tools found'));
  await say('Both searches finished.');
  return 'end_turn';
}
