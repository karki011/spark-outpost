import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import type { ApprovalRequest } from '../approvals/decide.ts';
import { PUBLISH_TURN_HEADING } from '../orchestration/context.ts';
import { findPullRequests } from '../tasks/pr-links.ts';
import type { ProviderOutput, ProviderTurn } from './provider.ts';

const run = promisify(execFile);

const BRANCH = /`git push origin ([^`\s]+)`/;
const NO_NEW_PULL_REQUEST = "Don't open another pull request";
const AUTHOR = ['-c', 'user.email=fake-agent@example.test', '-c', 'user.name=Fake Agent'];

export function wantsPublish(prompt: string): boolean {
  return prompt.includes(PUBLISH_TURN_HEADING);
}

async function shell(file: string, args: string[], cwd: string) {
  try {
    const { stdout, stderr } = await run(file, args, { cwd });
    return { ok: true, output: `${stdout}${stderr}`.trim() };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; message: string };
    return { ok: false, output: `${failed.stdout ?? ''}${failed.stderr ?? failed.message}`.trim() };
  }
}

function command(id: string, root: string, text: string): ApprovalRequest {
  return {
    toolCallId: id,
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title: text,
    command: text,
    cwd: root,
    paths: [],
    diffs: [],
    options: [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
    ],
    roots: [{ path: root, ignore: [] }],
    home: homedir(),
  };
}

export async function* fakePublishTurn(turn: ProviderTurn): AsyncGenerator<ProviderOutput> {
  const asked = turn.prompt.slice(turn.prompt.lastIndexOf(PUBLISH_TURN_HEADING));
  const root = turn.projectRoots?.[0];
  const branch = BRANCH.exec(asked)?.[1];
  if (!turn.approvals || !root || !branch) {
    yield { kind: 'text_delta', delta: 'published=no reason=no project folder' };
    return;
  }
  const steps: [string, string, string[]][] = [
    ['fake-publish-push', 'git', ['push', 'origin', branch]],
    ...(asked.includes(NO_NEW_PULL_REQUEST)
      ? []
      : ([
          [
            'fake-publish-pr',
            'gh',
            ['pr', 'create', '--title', 'Publish the change', '--body', 'Opened by the fake agent'],
          ],
        ] as [string, string, string[]][])),
  ];
  await shell('git', ['add', '-A'], root);
  await shell('git', [...AUTHOR, 'commit', '-qm', 'Publish the change'], root);
  let last = '';
  for (const [id, file, args] of steps) {
    const text = [file, ...args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg))].join(' ');
    yield { kind: 'step_started', name: text, tool: true };
    const answer = await turn.approvals.review(command(id, root, text), turn.signal);
    yield { kind: 'step_finished', name: text };
    if (answer.outcome === 'cancelled') return;
    const ran = answer.allowed ? await shell(file, args, root) : { ok: false, output: 'refused' };
    last = ran.output;
    if (!ran.ok) {
      yield { kind: 'text_delta', delta: `published=no ${file}=${last.split('\n').at(-1)}` };
      return;
    }
    for (const pull of findPullRequests(last))
      yield { kind: 'link', ...pull, source: 'tool_output' };
  }
  yield { kind: 'text_delta', delta: `published=${last.split('\n').at(-1) || 'pushed'}` };
}
