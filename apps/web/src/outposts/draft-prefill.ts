import {
  OUTPOST_NAME_MAX,
  chatModeRank,
  leadModeLimit,
  modeKind,
  modePosture,
  type DraftChat,
  type ModePosture,
  type OutpostDraft,
  type ProviderCapabilities,
  type ProviderId,
} from '@spark-outpost/contracts';
import {
  emptyChat,
  withChat,
  withExistingChat,
  type AgentChoice,
  type ChatDraft,
  type CreateDraft,
  type JoinedOutpost,
  type NewId,
} from './create/create-draft.ts';
import { defaultMode, type CreateBase } from './create/use-create-data.ts';

export interface DraftSource {
  id: string;
  body: OutpostDraft;
}

export interface DraftLead {
  conversationId: string;
  posture: ModePosture;
  outpost: JoinedOutpost | null;
  agent?: AgentChoice;
}

type PrefillBase = Pick<
  CreateBase,
  'chats' | 'projects' | 'projectNames' | 'providers' | 'defaults' | 'capabilitiesOf'
>;

function rankOf(
  provider: ProviderId,
  mode: string | null,
  capabilities: ProviderCapabilities | undefined,
): number {
  return chatModeRank(modePosture(provider, mode, modeKind(capabilities?.modes ?? [], mode)));
}

export function cappedMode(
  provider: ProviderId,
  wanted: string | null,
  capabilities: ProviderCapabilities | undefined,
  lead: ModePosture,
): string | null {
  const limit = leadModeLimit(lead);
  const effective = wanted ?? defaultMode(provider, capabilities);
  if (rankOf(provider, effective, capabilities) <= limit) return wanted;
  const allowed = (capabilities?.modes ?? [])
    .map((mode) => ({ id: mode.id, rank: rankOf(provider, mode.id, capabilities) }))
    .filter((mode) => mode.rank <= limit);
  const highest = Math.max(...allowed.map((mode) => mode.rank));
  return allowed.find((mode) => mode.rank === highest)?.id ?? wanted;
}

function usualAgent(base: PrefillBase, lead: DraftLead): AgentChoice {
  const own = lead.agent;
  const connected = base.providers.some((provider) => provider.id === own?.provider);
  return own && connected ? own : base.defaults;
}

function agentFor(chat: DraftChat, base: PrefillBase, lead: DraftLead): AgentChoice {
  const usually = usualAgent(base, lead);
  const connected = base.providers.some((provider) => provider.id === chat.agent);
  const provider = connected && chat.agent ? chat.agent : usually.provider;
  if (provider === null) return { provider: null, model: null, agentMode: null };
  const usual = [usually, base.defaults].find((choice) => choice.provider === provider);
  const wanted = chat.agentMode ?? usual?.agentMode ?? null;
  return {
    provider,
    model: usual?.model ?? null,
    agentMode: cappedMode(provider, wanted, base.capabilitiesOf(provider), lead.posture),
  };
}

function newChat(chat: DraftChat, base: PrefillBase, lead: DraftLead, newId?: NewId): ChatDraft {
  const known = base.projects.some((project) => project.id === chat.projectId);
  return {
    ...emptyChat(agentFor(chat, base, lead), newId),
    kind: 'new',
    open: false,
    added: true,
    touched: true,
    projectId: known ? chat.projectId : null,
    handle: chat.handle,
    handleTyped: true,
    messageOpen: true,
    text: chat.task,
    storyTitle: chat.title,
  };
}

function withEdges(chats: readonly ChatDraft[], proposed: readonly DraftChat[]): ChatDraft[] {
  const keyOf = new Map<string, string>();
  for (const chat of chats) if (!keyOf.has(chat.handle)) keyOf.set(chat.handle, chat.key);
  return chats.map((chat, index) => {
    const parent = proposed[index]?.dependsOn;
    const key = parent === undefined ? undefined : keyOf.get(parent);
    return key === undefined || key === chat.key ? chat : { ...chat, dependsOn: key };
  });
}

function withLead(draft: CreateDraft, base: PrefillBase, lead: DraftLead, newId?: NewId) {
  const picked = base.chats.find((chat) => chat.id === lead.conversationId);
  const joined = lead.outpost?.members.some(
    (member) => member.conversationId === lead.conversationId,
  );
  if (!picked || joined) return draft;
  const row = emptyChat(base.defaults, newId);
  const added = withExistingChat(withChat(draft, row), row.key, picked, base.projectNames);
  const leadRow = added.chats.filter((chat) => chat.key === row.key);
  return { ...added, chats: [...leadRow, ...draft.chats] };
}

export function fromDraft(
  draft: DraftSource,
  base: PrefillBase,
  lead: DraftLead,
  newId?: NewId,
): CreateDraft {
  const proposed = draft.body.chats;
  const chats = withEdges(
    proposed.map((chat) => newChat(chat, base, lead, newId)),
    proposed,
  );
  const name = (draft.body.name ?? draft.body.title).slice(0, OUTPOST_NAME_MAX);
  const started: CreateDraft = {
    name: lead.outpost?.name ?? name,
    chats,
    origin: { draftId: draft.id, leadChatId: lead.conversationId },
    ...(lead.outpost ? { into: lead.outpost } : {}),
  };
  return withLead(started, base, lead, newId);
}
