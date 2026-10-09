import { useQuery } from '@tanstack/react-query';
import { modeKind, modePosture, type ChatSettings, type Outpost } from '@spark-outpost/contracts';
import { ApiError, api, queryKeys } from '../../api/client.ts';
import { fromDraft } from '../draft-prefill.ts';
import { outpostKeys, outpostsApi, type ProposedDraft } from '../outposts-api.ts';
import { useOutposts } from '../use-outposts.ts';
import type { CreateDraft, JoinedOutpost } from './create-draft.ts';
import type { CreateBase } from './use-create-data.ts';

export const DRAFT_GONE = 'That draft no longer exists.';
export const LEAD_GONE = 'The chat that proposed this draft was deleted, so it cannot be started.';
export const OUTPOST_GONE = 'The outpost this draft belongs to was deleted.';
export const DRAFT_UNREADABLE = 'The draft could not be opened. Try again.';

export interface ReadyDraft {
  status: 'ready';
  seed: () => CreateDraft;
  outpostId: string | null;
}

export type DraftStart =
  | { status: 'loading' }
  | { status: 'gone'; message: string }
  | { status: 'started'; outpostId: string }
  | ReadyDraft;

const LOADING: DraftStart = { status: 'loading' };

function isMissing(error: Error): boolean {
  return error instanceof ApiError && error.status === 404;
}

function gone(message: string): DraftStart {
  return { status: 'gone', message };
}

function joined(outpost: Outpost): JoinedOutpost {
  return { outpostId: outpost.id, name: outpost.name, members: outpost.members };
}

function leadPosture(settings: ChatSettings, base: CreateBase) {
  const modes = settings.provider ? (base.capabilitiesOf(settings.provider)?.modes ?? []) : [];
  return modePosture(settings.provider, settings.agentMode, modeKind(modes, settings.agentMode));
}

function loaded(base: CreateBase): boolean {
  return base.providers.every(
    (provider) => base.capabilitiesOf(provider.id) !== undefined || !base.loadingOf(provider.id),
  );
}

function targetOf(
  draft: ProposedDraft,
  leadChatId: string,
  base: CreateBase,
  outposts: readonly Outpost[],
): JoinedOutpost | null | 'gone' {
  const lead = base.chats.find((chat) => chat.id === leadChatId);
  const outpostId = draft.outpostId ?? lead?.outpost?.id ?? null;
  if (outpostId === null) return null;
  const outpost = outposts.find((candidate) => candidate.id === outpostId);
  return outpost ? joined(outpost) : 'gone';
}

export function useDraftStart(draftId: string, base: CreateBase | null): DraftStart {
  const draft = useQuery({
    queryKey: outpostKeys.draft(draftId),
    queryFn: () => outpostsApi.getDraft(draftId),
    retry: false,
  });
  const leadChatId = draft.data?.conversationId ?? null;
  const lead = useQuery({
    queryKey: queryKeys.conversation(leadChatId ?? ''),
    queryFn: () => api.getConversation(leadChatId ?? ''),
    enabled: leadChatId !== null,
  });
  const outposts = useOutposts().data;
  const ready = base !== null && loaded(base);
  const settings = lead.data?.settings;

  const proposed = draft.data;
  if (!proposed && draft.error) {
    return gone(isMissing(draft.error) ? DRAFT_GONE : DRAFT_UNREADABLE);
  }
  if (!proposed) return LOADING;
  if (proposed.startedAt !== null && proposed.outpostId !== null) {
    return { status: 'started', outpostId: proposed.outpostId };
  }
  if (leadChatId === null) return gone(LEAD_GONE);
  if (!settings && lead.error) return gone(isMissing(lead.error) ? LEAD_GONE : DRAFT_UNREADABLE);
  if (!ready || !settings || !outposts) return LOADING;
  const target = targetOf(proposed, leadChatId, base, outposts);
  if (target === 'gone') return gone(OUTPOST_GONE);
  const posture = leadPosture(settings, base);
  return {
    status: 'ready',
    seed: () => fromDraft(proposed, base, { conversationId: leadChatId, posture, outpost: target }),
    outpostId: target?.outpostId ?? null,
  };
}
