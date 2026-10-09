import type { ConversationSummary, OutpostMember } from '@spark-outpost/contracts';
import { providerName } from '../chat/provider-name.ts';

type MemberState = 'idle' | 'working' | 'needs_you' | 'failed' | 'archived';

export interface MemberView {
  conversationId: string;
  handle: string;
  title: string;
  place: string;
  agent: string | null;
  state: MemberState;
  stateLabel: string;
  archived: boolean;
}

const STATE_LABELS: Record<MemberState, string> = {
  idle: 'Idle',
  working: 'Working',
  needs_you: 'Needs you',
  failed: 'Failed',
  archived: 'Archived',
};

function stateOf(chat: ConversationSummary | undefined): MemberState {
  if (!chat) return 'idle';
  if (chat.archivedAt) return 'archived';
  if (chat.needsInput) return 'needs_you';
  const status = chat.latestRun?.status;
  if (status === 'queued' || status === 'running') return 'working';
  if (status === 'awaiting_approval') return 'needs_you';
  if (status === 'succeeded' && chat.latestRun?.needsYou) return 'needs_you';
  if (status === 'failed' || status === 'outcome_unknown') return 'failed';
  return 'idle';
}

export function chatPlace(
  chat: ConversationSummary | undefined,
  projectNames: Readonly<Record<string, string>>,
): string {
  if (!chat) return '';
  const project = chat.projectIds.map((id) => projectNames[id]).find(Boolean);
  return [project, chat.branch].filter(Boolean).join(' · ');
}

export function memberViews(
  members: readonly OutpostMember[],
  chats: readonly ConversationSummary[],
  projectNames: Readonly<Record<string, string>>,
): MemberView[] {
  const byId = new Map(chats.map((chat) => [chat.id, chat]));
  return [...members]
    .sort((a, b) => a.position - b.position)
    .map((member) => {
      const chat = byId.get(member.conversationId);
      const state = stateOf(chat);
      const provider = chat?.latestRun?.provider ?? null;
      return {
        conversationId: member.conversationId,
        handle: member.handle,
        title: chat?.title ?? `@${member.handle}`,
        place: chatPlace(chat, projectNames),
        agent: provider ? providerName(provider) : null,
        state,
        stateLabel: STATE_LABELS[state],
        archived: state === 'archived',
      };
    });
}

export function memberDetails(member: MemberView): string {
  return [member.title, member.place, member.agent].filter(Boolean).join(' · ');
}

export function membersLabel(count: number): string {
  if (count === 0) return 'No chats yet';
  return count === 1 ? 'You and 1 chat' : `You and ${count} chats`;
}
