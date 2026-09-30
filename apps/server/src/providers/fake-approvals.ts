import { readFile, writeFile } from 'node:fs/promises';
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
  const requests: ApprovalRequest[] = [];
  if (edits && prompt.includes(FAKE_EDIT_TRIGGER)) {
    const target = path.join(root, FAKE_EDIT_FILE);
    const oldText = await currentText(target);
    requests.push({
      ...base,
      toolCallId: 'fake-edit',
      kind: 'edit',
      toolKind: 'edit',
      title: `Edit ${FAKE_EDIT_FILE}`,
      command: null,
      cwd: null,
      paths: [target],
      diffs: [{ path: target, oldText, newText: `${oldText ?? ''}Edited by the fake agent\n` }],
    });
  }
  if (prompt.includes(FAKE_COMMAND_TRIGGER)) requests.push(command('fake-run', FAKE_COMMAND));
  if (prompt.includes(FAKE_PUSH_TRIGGER))
    requests.push(command('fake-push', 'git push origin main'));
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
    if (answer.allowed && diff) await writeFile(diff.path, diff.newText);
  }
  yield { kind: 'text_delta', delta: `Done. ${outcomes.join(' ')}` };
}
