import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ApprovalOption } from '@spark-outpost/contracts';
import type { ApprovalRequest } from '../approvals/decide.ts';
import type { ProviderOutput, ProviderTurn } from './provider.ts';

export const FAKE_COMMAND_TRIGGER = '#approve';
export const FAKE_EDIT_TRIGGER = '#edit';
export const FAKE_PUSH_TRIGGER = '#push';
export const FAKE_FORCE_PUSH_TRIGGER = '#leasepush';
export const FAKE_CURL_TRIGGER = '#curl';
export const FAKE_READ_ENV_TRIGGER = '#readenv';
export const FAKE_INSTRUCTIONS_TRIGGER = '#instructions';
export const FAKE_HOOK_TRIGGER = '#githook';
export const FAKE_COMMAND = 'pnpm test -- groupMessages';
export const FAKE_EDIT_FILE = 'notes.txt';

const OPTIONS: ApprovalOption[] = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
];

export function wantsApproval(prompt: string): boolean {
  const triggers = [
    FAKE_COMMAND_TRIGGER,
    FAKE_EDIT_TRIGGER,
    FAKE_PUSH_TRIGGER,
    FAKE_FORCE_PUSH_TRIGGER,
    FAKE_CURL_TRIGGER,
    FAKE_READ_ENV_TRIGGER,
    FAKE_INSTRUCTIONS_TRIGGER,
    FAKE_HOOK_TRIGGER,
  ];
  return triggers.some((trigger) => prompt.includes(trigger));
}

async function currentText(target: string): Promise<string | null> {
  try {
    return await readFile(target, 'utf8');
  } catch {
    return null;
  }
}

async function fakeRequests(
  prompt: string,
  root: string,
  edits: boolean,
): Promise<ApprovalRequest[]> {
  const base = {
    rpcId: null,
    options: OPTIONS,
    roots: [{ path: root, ignore: [] }],
    home: homedir(),
  };
  const command = (id: string, text: string): ApprovalRequest => ({
    ...base,
    toolCallId: id,
    kind: 'execute',
    toolKind: 'execute',
    title: text,
    command: text,
    cwd: root,
    paths: [],
    diffs: [],
  });
  const edit = async (id: string, file: string): Promise<ApprovalRequest> => {
    const target = path.join(root, file);
    const oldText = await currentText(target);
    return {
      ...base,
      toolCallId: id,
      kind: 'edit',
      toolKind: 'edit',
      title: `Edit ${file}`,
      command: null,
      cwd: null,
      paths: [target],
      diffs: [{ path: target, oldText, newText: `${oldText ?? ''}Edited by the fake agent\n` }],
    };
  };
  const requests: ApprovalRequest[] = [];
  if (edits && prompt.includes(FAKE_EDIT_TRIGGER))
    requests.push(await edit('fake-edit', FAKE_EDIT_FILE));
  if (edits && prompt.includes(FAKE_INSTRUCTIONS_TRIGGER)) {
    requests.push(await edit('fake-instructions', 'AGENTS.md'));
  }
  if (edits && prompt.includes(FAKE_HOOK_TRIGGER)) {
    requests.push(await edit('fake-hook', '.git/hooks/pre-commit'));
  }
  if (prompt.includes(FAKE_COMMAND_TRIGGER)) requests.push(command('fake-run', FAKE_COMMAND));
  if (prompt.includes(FAKE_PUSH_TRIGGER))
    requests.push(command('fake-push', 'git push origin main'));
  if (prompt.includes(FAKE_READ_ENV_TRIGGER)) requests.push(command('fake-read-env', 'cat .env'));
  if (prompt.includes(FAKE_CURL_TRIGGER)) {
    requests.push(command('fake-curl', 'curl -sI https://example.com'));
  }
  if (prompt.includes(FAKE_FORCE_PUSH_TRIGGER)) {
    requests.push(command('fake-force-push', 'git push --force-with-lease origin feature'));
  }
  return requests;
}

const note = (name: string): ProviderOutput[] => [
  { kind: 'step_started', name },
  { kind: 'step_finished', name },
];

export async function* fakeApprovalTurn(turn: ProviderTurn): AsyncGenerator<ProviderOutput> {
  const root = turn.projectRoots?.[0];
  if (!turn.approvals || !root) {
    yield* note('Declined: approvals need a Do chat with a project folder');
    yield { kind: 'text_delta', delta: 'permission=unavailable' };
    return;
  }
  const outcomes: string[] = [];
  for (const request of await fakeRequests(turn.prompt, root, turn.mode === 'do')) {
    yield { kind: 'step_started', name: request.title, tool: true };
    const answer = await turn.approvals.review(request, turn.signal);
    yield { kind: 'step_finished', name: request.title };
    yield* note(answer.note);
    if (answer.outcome === 'cancelled') return;
    outcomes.push(`${request.toolCallId}=${answer.allowed ? 'allowed' : 'denied'}`);
    const diff = request.diffs[0];
    if (answer.allowed && diff) {
      await mkdir(path.dirname(diff.path), { recursive: true });
      await writeFile(diff.path, diff.newText);
    }
  }
  yield { kind: 'text_delta', delta: `Done. ${outcomes.join(' ')}` };
}
