import {
  OUTPOST_NAME_MAX,
  aboveLeadMode,
  cappedMode,
  defaultModeFor,
  suggestHandle,
  type ChatSettings,
  type CreateOutpostRequest,
  type DraftChat,
  type ModePosture,
  type StartMember,
} from '@spark-outpost/contracts';
import { getCapabilities, resolveChatSettings } from '../persistence/chat-settings.ts';
import type { Queryable } from '../persistence/db.ts';
import { outpostOf, OutpostError } from '../persistence/outposts.ts';
import { providerModePosture } from './chat-posture.ts';
import { modeAboveLead } from './mode-cap.ts';
import type { StoredDraft } from './ports.ts';
import { LEAD_CHAT_GONE } from './story-start.ts';

export const LEAD_HAS_NO_AGENT = 'The chat that proposed this draft has no agent to start with.';

export interface DraftRequestDeps {
  db: Queryable;
  workspaceId: string;
  newId: () => string;
}

interface Lead {
  conversationId: string;
  settings: ChatSettings;
  posture: ModePosture;
  outpost: { id: string; name: string; handle: string } | null;
}

async function leadName(db: Queryable, conversationId: string): Promise<string> {
  const { rows } = await db.query<{ name: string | null; title: string }>(
    `SELECT (SELECT p.name FROM conversation_projects cp JOIN projects p ON p.id = cp.project_id
             WHERE cp.conversation_id = c.id ORDER BY cp.position, cp.created_at LIMIT 1) AS name,
            c.title
     FROM conversations c WHERE c.id = $1`,
    [conversationId],
  );
  const row = rows[0];
  if (!row) throw new OutpostError(409, LEAD_CHAT_GONE);
  return row.name ?? row.title;
}

async function leadOf(
  { db, workspaceId }: DraftRequestDeps,
  conversationId: string,
): Promise<Lead> {
  const settings = await resolveChatSettings(db, conversationId);
  const posture = await providerModePosture(db, workspaceId, settings.provider, settings.agentMode);
  const joined = await outpostOf(db, conversationId);
  return {
    conversationId,
    settings,
    posture,
    outpost: joined
      ? {
          id: joined.outpost.id,
          name: joined.outpost.name,
          handle: joined.member.handle,
        }
      : null,
  };
}

interface Placed {
  lead: Lead;
  leadHandle: string;
  chatIds: ReadonlyMap<string, string>;
}

function chatIdOf(chatIds: ReadonlyMap<string, string>, handle: string): string {
  const id = chatIds.get(handle);
  if (id === undefined) throw new Error(`No chat id for @${handle}.`);
  return id;
}

async function newMember(
  deps: DraftRequestDeps,
  { lead, leadHandle, chatIds }: Placed,
  chat: DraftChat,
): Promise<StartMember> {
  const provider = chat.agent ?? lead.settings.provider;
  if (!provider) throw new OutpostError(409, LEAD_HAS_NO_AGENT);
  const sameAgent = provider === lead.settings.provider;
  const wanted = chat.agentMode ?? (sameAgent ? lead.settings.agentMode : null);
  const capabilities = (await getCapabilities(deps.db, deps.workspaceId, provider)) ?? undefined;
  const agentMode = cappedMode(provider, wanted, capabilities, lead.posture);
  const effective = agentMode ?? capabilities?.defaultMode ?? defaultModeFor(provider);
  const posture = await providerModePosture(deps.db, deps.workspaceId, provider, effective);
  if (aboveLeadMode(lead.posture, posture)) {
    throw new OutpostError(400, modeAboveLead(chat.handle, leadHandle));
  }
  const parent = chat.dependsOn === undefined ? undefined : chatIds.get(chat.dependsOn);
  return {
    new: {
      conversationId: chatIdOf(chatIds, chat.handle),
      projectId: chat.projectId,
      provider,
      model: sameAgent ? lead.settings.model : null,
      agentMode,
    },
    handle: chat.handle,
    firstMessage: { id: deps.newId(), text: chat.task, attachmentIds: [] },
    ...(parent === undefined ? {} : { dependsOn: parent }),
  };
}

async function leadHandleOf(db: Queryable, lead: Lead, draft: StoredDraft): Promise<string> {
  if (lead.outpost) return lead.outpost.handle;
  const taken = draft.body.chats.map((chat) => chat.handle);
  return suggestHandle(await leadName(db, lead.conversationId), taken);
}

export async function draftStartRequest(
  deps: DraftRequestDeps,
  draft: StoredDraft,
  joined: ReadonlySet<string> = new Set(),
): Promise<CreateOutpostRequest> {
  if (draft.conversationId === null) throw new OutpostError(409, LEAD_CHAT_GONE);
  const lead = await leadOf(deps, draft.conversationId);
  const placed: Placed = {
    lead,
    leadHandle: await leadHandleOf(deps.db, lead, draft),
    chatIds: new Map(draft.body.chats.map((chat) => [chat.handle, deps.newId()])),
  };
  const members: StartMember[] = lead.outpost
    ? []
    : [{ conversationId: lead.conversationId, handle: placed.leadHandle }];
  for (const chat of draft.body.chats) {
    if (joined.has(chat.handle)) continue;
    const parentJoined = chat.dependsOn !== undefined && joined.has(chat.dependsOn);
    members.push(
      await newMember(deps, placed, parentJoined ? { ...chat, dependsOn: undefined } : chat),
    );
  }
  const name =
    lead.outpost?.name ?? (draft.body.name ?? draft.body.title).slice(0, OUTPOST_NAME_MAX);
  return {
    id: draft.outpostId ?? lead.outpost?.id ?? deps.newId(),
    name,
    members,
    draftId: draft.id,
  };
}
