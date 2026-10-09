import type { ConversationSummary, ProviderCapabilities } from '@spark-outpost/contracts';
import { shortLabel } from '../../chat/composer/model-options.ts';
import { permissionState, type PermissionRisk } from '../../chat/composer/mode-summary.ts';
import { providerName } from '../../chat/provider-name.ts';
import { countLabel } from '../../ui/count-label.ts';
import { memberId, type AgentChoice, type ChatDraft } from './create-draft.ts';
import type { StartSummary } from './create-request.ts';

export const AUTO_MODEL = 'Auto';

export interface AgentView {
  provider: string;
  model: string;
  agent: string;
  mode: string;
  modeId: string | null;
  risk: PermissionRisk;
}

export interface ChatView {
  faceId: string;
  title: string;
  tag: 'Existing' | 'New';
  meta: string;
}

export function agentView(
  choice: AgentChoice,
  capabilities: ProviderCapabilities | undefined,
): AgentView | null {
  if (choice.provider === null) return null;
  const option = capabilities?.models.find((model) => model.id === choice.model);
  const model = choice.model === null ? AUTO_MODEL : shortLabel(option?.label ?? choice.model);
  const provider = providerName(choice.provider);
  const permission = permissionState(
    {
      provider: choice.provider,
      model: choice.model,
      effort: null,
      permission: null,
      agentMode: choice.agentMode,
      level: null,
      options: {},
    },
    capabilities,
  );
  return {
    provider,
    model,
    agent: `${provider} ${model}`,
    mode: permission.label,
    modeId: permission.mode,
    risk: permission.risk,
  };
}

interface ChatViewContext {
  chats: readonly ConversationSummary[];
  projectNames: Readonly<Record<string, string>>;
  agent: AgentView | null;
}

function projectOf(
  chat: ChatDraft,
  picked: ConversationSummary | undefined,
  names: ChatViewContext['projectNames'],
) {
  if (chat.kind === 'new') return chat.projectId ? (names[chat.projectId] ?? null) : null;
  return picked?.projectIds.map((id) => names[id]).find(Boolean) ?? null;
}

export function faceIds(chats: readonly ChatDraft[]): string[] {
  return chats.map((chat) => memberId(chat) ?? chat.key);
}

export function chatView(
  chat: ChatDraft,
  { chats, projectNames, agent }: ChatViewContext,
): ChatView {
  const picked = chats.find((candidate) => candidate.id === chat.chatId);
  const project = projectOf(chat, picked, projectNames);
  const newTitle = project ? `New chat in ${project}` : 'New chat';
  return {
    faceId: faceIds([chat])[0]!,
    title: chat.kind === 'new' ? newTitle : (picked?.title ?? 'Choose a chat'),
    tag: chat.kind === 'new' ? 'New' : 'Existing',
    meta: [project, agent?.agent, agent?.mode].filter(Boolean).join(' · '),
  };
}

export function filesCount(count: number): string {
  return countLabel(count, 'file');
}

export function summaryLine({ chats, newChats, firstRequests }: StartSummary): string {
  return [
    countLabel(chats, 'chat'),
    newChats > 0 ? `${newChats} new` : null,
    firstRequests > 0 ? countLabel(firstRequests, 'first message') : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function startLines({ newChats, firstRequests }: StartSummary): string[] {
  return [
    newChats > 0 ? `Creates ${countLabel(newChats, 'new chat')}` : null,
    firstRequests > 0 ? `Sends ${countLabel(firstRequests, 'first request')}` : null,
    'Each chat works under its own mode.',
  ].filter((line): line is string => line !== null);
}
