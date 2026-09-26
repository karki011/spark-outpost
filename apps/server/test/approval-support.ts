import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type { InvolvementLevel, RunEvent } from '@spark-outpost/contracts';
import type { ApprovalRequest } from '../src/approvals/decide.ts';
import { setConversationProjects } from '../src/persistence/conversation-projects.ts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import type { AppendOptions } from '../src/persistence/run-events.ts';
import { createProject } from '../src/projects/projects.ts';
import type { TestDb } from './support.ts';

export interface LinkedRun {
  conversationId: string;
  projectId: string;
  runId: string;
}

export async function linkedConversation(t: TestDb, root: string) {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  const { project } = await createProject(t.db, t.workspaceId, root);
  await setConversationProjects(t.db, t.workspaceId, conversation.id, [project.id]);
  return { conversationId: conversation.id, projectId: project.id };
}

export async function sendDo(
  t: TestDb,
  conversationId: string,
  content: string,
  level: InvolvementLevel = 'balanced',
): Promise<string> {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    { provider: 'fake', permission: 'do', level },
  );
  return sent.run.id;
}

export async function doRun(
  t: TestDb,
  root: string,
  content = 'work',
  level: InvolvementLevel = 'balanced',
): Promise<LinkedRun> {
  const linked = await linkedConversation(t, root);
  return { ...linked, runId: await sendDo(t, linked.conversationId, content, level) };
}

export function commandRequest(root: string, command: string, id = 'call-1'): ApprovalRequest {
  return {
    toolCallId: id,
    rpcId: '7',
    kind: 'execute',
    toolKind: 'execute',
    title: command,
    command,
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

export interface RecordedEvent {
  event: RunEvent;
  options: AppendOptions | undefined;
}

export function recordingAppend() {
  const events: RecordedEvent[] = [];
  const append = async (event: RunEvent, options?: AppendOptions) => {
    events.push({ event, options });
    return events.length;
  };
  return { events, append };
}
