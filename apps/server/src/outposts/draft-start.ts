import { startedOutpostLine, type FailedMember } from '@spark-outpost/contracts';
import { insertFinishedRunEntries } from '../persistence/audit-log.ts';
import type { Db } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import { getDraft } from '../persistence/outpost-drafts.ts';
import { getOutpost, notifyOutpostChanged, OutpostError } from '../persistence/outposts.ts';
import { draftStartRequest } from './draft-request.ts';
import type { StoredDraft } from './ports.ts';
import { DRAFT_NOT_FOUND, startOutpost, type StartDeps, type StartedBy } from './start-outpost.ts';

export interface DraftStarted {
  draftId: string;
  runId: string | null;
  outpostId: string;
  outpostName: string;
  started: number;
  failed: FailedMember[];
  already: boolean;
}

export function draftStartedMessage(result: DraftStarted): string {
  const line = startedOutpostLine(result.outpostName, result.started);
  if (result.already) return `${line} It was already started.`;
  const reasons = result.failed.map(({ handle, message }) => `@${handle}: ${message}`);
  return [line, ...reasons].join(' ');
}

async function joinedHandles(deps: StartDeps, draft: StoredDraft): Promise<Set<string>> {
  if (draft.startedAt === null || draft.outpostId === null) return new Set();
  const outpost = await getOutpost(deps.db, deps.workspaceId, draft.outpostId);
  const members = new Set(outpost?.members.map((member) => member.handle) ?? []);
  const handles = draft.body.chats.map((chat) => chat.handle);
  return new Set(handles.filter((handle) => members.has(handle)));
}

async function alreadyStarted(deps: StartDeps, draft: StoredDraft): Promise<DraftStarted> {
  const outpostId = draft.outpostId ?? '';
  const outpost = await getOutpost(deps.db, deps.workspaceId, outpostId);
  return {
    draftId: draft.id,
    runId: draft.runId,
    outpostId,
    outpostName: outpost?.name ?? '',
    started: draft.body.chats.length,
    failed: [],
    already: true,
  };
}

export async function startDraft(
  deps: StartDeps,
  draftId: string,
  startedBy: StartedBy,
): Promise<DraftStarted> {
  const draft = await getDraft(deps.db, deps.workspaceId, draftId);
  if (!draft) throw new OutpostError(404, DRAFT_NOT_FOUND);
  const joined = await joinedHandles(deps, draft);
  if (draft.startedAt !== null && joined.size === draft.body.chats.length) {
    return alreadyStarted(deps, draft);
  }
  const request = await draftStartRequest({ ...deps, newId }, draft, joined);
  const { failed } = await startOutpost(deps, request, startedBy);
  await notifyOutpostChanged(deps.db, request.id, draft.conversationId);
  const refused = new Set(failed.map((member) => member.handle));
  return {
    draftId: draft.id,
    runId: draft.runId,
    outpostId: request.id,
    outpostName: request.name,
    started: draft.body.chats.filter((chat) => !refused.has(chat.handle)).length,
    failed,
    already: false,
  };
}

export async function auditDraftStart(db: Db, result: DraftStarted, by: string): Promise<void> {
  if (result.runId === null) return;
  const payload = {
    action: { action: 'start_outpost', draftId: result.draftId },
    outcome: 'done',
    startedBy: by,
    outpostId: result.outpostId,
    started: result.started,
    failed: result.failed.map(({ handle, message }) => ({ handle, message })),
  };
  await insertFinishedRunEntries(db, result.runId, [
    {
      at: new Date(),
      direction: 'harness',
      kind: 'notification',
      method: 'spark/start_outpost',
      rpcId: null,
      sizeBytes: Buffer.byteLength(JSON.stringify(payload)),
      truncated: false,
      payload,
    },
  ]);
}
