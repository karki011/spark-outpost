import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import * as acp from '@agentclientprotocol/sdk';
import type { FakeTurn } from './fake-acp-build.ts';

const run = promisify(execFile);

const PUBLISH_HEADING = '## Publish this change';
const BRANCH = /`git push origin ([^`\s]+)`/;
const PULL_BASE = /`gh pr create --base ([^`\s]+)`/;
const PULL_STEP = '`gh pr create`';
const FOLLOW_UP = "Don't open another pull request";
const FAKE_GH = path.resolve(import.meta.dirname, '../../../tests/browser/bin/gh');
const AUTHOR = ['-c', 'user.email=agent@example.test', '-c', 'user.name=Fake Agent'];

interface Ran {
  ok: boolean;
  output: string;
}

async function shell(file: string, args: string[], cwd: string): Promise<Ran> {
  try {
    const { stdout, stderr } = await run(file, args, { cwd, env: process.env });
    return { ok: true, output: `${stdout}${stderr}` };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; message: string };
    return { ok: false, output: `${failed.stdout ?? ''}${failed.stderr ?? failed.message}` };
  }
}

async function allowed(turn: FakeTurn, id: string, command: string): Promise<boolean> {
  const tool = { toolCallId: id, title: command, kind: 'execute' as const };
  await turn.update({
    sessionUpdate: 'tool_call',
    ...tool,
    rawInput: { command },
    status: 'pending',
  });
  const answer = await turn.client.request(acp.methods.client.session.requestPermission, {
    sessionId: turn.sessionId,
    toolCall: { ...tool, rawInput: { command }, status: 'pending' },
    options: [
      { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
      { optionId: 'no', name: 'No', kind: 'reject_once' },
    ],
  });
  return answer.outcome.outcome === 'selected' && answer.outcome.optionId === 'yes';
}

function quoted(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}

async function command(turn: FakeTurn, id: string, file: string, args: string[]): Promise<Ran> {
  const text = [file === FAKE_GH ? 'gh' : file, ...args.map(quoted)].join(' ');
  if (!(await allowed(turn, id, text))) {
    await turn.update({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'failed' });
    return { ok: false, output: 'refused' };
  }
  const ran = await shell(file, args, turn.cwd);
  await turn.update({
    sessionUpdate: 'tool_call_update',
    toolCallId: id,
    status: ran.ok ? 'completed' : 'failed',
    rawOutput: { text: ran.output },
  });
  return ran;
}

export async function publishTurn(turn: FakeTurn): Promise<acp.StopReason | null> {
  const at = turn.text.lastIndexOf(PUBLISH_HEADING);
  if (at < 0) return null;
  const asked = turn.text.slice(at);
  const branch = BRANCH.exec(asked)?.[1];
  if (!branch) return null;
  if (process.env.FAKE_ACP_PUBLISH_FAILS) throw new Error('The publish prompt failed.');
  await shell('git', ['add', '-A'], turn.cwd);
  await shell('git', [...AUTHOR, 'commit', '-qm', 'Publish the change'], turn.cwd);
  if (turn.text.includes('#nopush')) {
    await turn.say('published=no reason=asked not to push');
    return 'end_turn';
  }
  const pushed = await command(turn, 'publish-push', 'git', ['push', 'origin', branch]);
  if (!pushed.ok) {
    await turn.say(`published=no push=${pushed.output.trim().split('\n').at(-1)}`);
    return 'end_turn';
  }
  if (asked.includes(FOLLOW_UP) || !asked.includes(PULL_STEP) || turn.text.includes('#nopr')) {
    await turn.say('published=pushed');
    return 'end_turn';
  }
  const draft = asked.includes('--draft') ? ['--draft'] : [];
  const named = PULL_BASE.exec(asked)?.[1];
  const base = named ? ['--base', named] : [];
  const opened = await command(turn, 'publish-pr', FAKE_GH, [
    'pr',
    'create',
    '--title',
    'Publish the change',
    '--body',
    asked,
    ...draft,
    ...base,
  ]);
  await turn.say(
    opened.ok ? `published=${opened.output.trim()}` : `published=no pr=${opened.output}`,
  );
  return 'end_turn';
}
