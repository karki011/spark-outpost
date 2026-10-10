import {
  suggestHandle,
  type Attachment,
  type ConversationSummary,
  type InvolvementLevel,
  type ProviderId,
} from '@spark-outpost/contracts';

export type ChatKind = 'existing' | 'new';

export interface AgentChoice {
  provider: ProviderId | null;
  model: string | null;
  agentMode: string | null;
}

export interface ChatDraft extends AgentChoice {
  key: string;
  kind: ChatKind;
  open: boolean;
  added: boolean;
  touched: boolean;
  chatId: string | null;
  newChatId: string;
  projectId: string | null;
  handle: string;
  handleTyped: boolean;
  messageId: string;
  messageOpen: boolean;
  text: string;
  files: Attachment[];
  filesPending: boolean;
  dependsOn: string | null;
  level: InvolvementLevel | null;
}

export interface DraftOrigin {
  draftId: string;
  leadChatId: string;
}

export interface JoinedOutpost {
  outpostId: string;
  name: string;
  members: readonly { conversationId: string; handle: string }[];
}

export interface CreateDraft {
  name: string;
  chats: ChatDraft[];
  origin?: DraftOrigin;
  into?: JoinedOutpost;
}

export type NewId = () => string;

const randomId: NewId = () => crypto.randomUUID();

export function emptyChat(agent: AgentChoice, newId: NewId = randomId): ChatDraft {
  return {
    ...agent,
    key: newId(),
    kind: 'existing',
    open: true,
    added: false,
    touched: false,
    chatId: null,
    newChatId: newId(),
    projectId: null,
    handle: '',
    handleTyped: false,
    messageId: newId(),
    messageOpen: false,
    text: '',
    files: [],
    filesPending: false,
    dependsOn: null,
    level: null,
  };
}

export function memberId(chat: ChatDraft): string | null {
  return chat.kind === 'new' ? chat.newChatId : chat.chatId;
}

export function listedChats(draft: CreateDraft): ChatDraft[] {
  return draft.chats.filter((chat) => chat.touched);
}

export function joinedHandles(draft: CreateDraft): string[] {
  return draft.into?.members.map((member) => member.handle) ?? [];
}

function otherHandles(draft: CreateDraft, key: string): string[] {
  const listed = listedChats(draft)
    .filter((chat) => chat.key !== key && chat.handle !== '')
    .map((chat) => chat.handle);
  return [...joinedHandles(draft), ...listed];
}

function changed(
  draft: CreateDraft,
  key: string,
  change: (chat: ChatDraft) => Partial<ChatDraft>,
): CreateDraft {
  return {
    ...draft,
    chats: draft.chats.map((chat) =>
      chat.key === key ? { ...chat, ...change(chat), touched: true } : chat,
    ),
  };
}

export function patchChat(
  draft: CreateDraft,
  key: string,
  changes: Partial<ChatDraft>,
): CreateDraft {
  return changed(draft, key, () => changes);
}

export function withKind(draft: CreateDraft, key: string, kind: ChatKind): CreateDraft {
  return {
    ...draft,
    chats: draft.chats.map((chat) => (chat.key === key ? { ...chat, kind } : chat)),
  };
}

function suggested(chat: ChatDraft, name: string, taken: readonly string[]): Partial<ChatDraft> {
  return chat.handleTyped ? {} : { handle: suggestHandle(name, taken) };
}

export function withExistingChat(
  draft: CreateDraft,
  key: string,
  picked: ConversationSummary,
  projectNames: Readonly<Record<string, string>>,
): CreateDraft {
  const project = picked.projectIds.map((id) => projectNames[id]).find(Boolean);
  const taken = otherHandles(draft, key);
  return changed(draft, key, (chat) => ({
    kind: 'existing',
    chatId: picked.id,
    open: false,
    added: true,
    ...suggested(chat, project ?? picked.title, taken),
  }));
}

export function withProject(
  draft: CreateDraft,
  key: string,
  project: { id: string; name: string },
): CreateDraft {
  const taken = otherHandles(draft, key);
  return changed(draft, key, (chat) => ({
    projectId: project.id,
    ...suggested(chat, project.name, taken),
  }));
}

export function withHandle(draft: CreateDraft, key: string, typed: string): CreateDraft {
  const handle = typed.replace(/^@+/, '').toLowerCase();
  return patchChat(draft, key, { handle, handleTyped: true });
}

export function withFiles(
  draft: CreateDraft,
  key: string,
  files: Attachment[],
  filesPending: boolean,
): CreateDraft {
  const chat = draft.chats.find((candidate) => candidate.key === key);
  if (!chat) return draft;
  const same =
    chat.filesPending === filesPending &&
    chat.files.length === files.length &&
    chat.files.every((file, index) => file.id === files[index]?.id);
  if (same) return draft;
  return {
    ...draft,
    chats: draft.chats.map((candidate) =>
      candidate.key === key ? { ...candidate, files, filesPending } : candidate,
    ),
  };
}

export function withoutChat(draft: CreateDraft, key: string): CreateDraft {
  return {
    ...draft,
    chats: draft.chats
      .filter((chat) => chat.key !== key)
      .map((chat) => (chat.dependsOn === key ? { ...chat, dependsOn: null } : chat)),
  };
}

export function withChat(draft: CreateDraft, chat: ChatDraft): CreateDraft {
  return { ...draft, chats: [...draft.chats, chat] };
}

export function settled(draft: CreateDraft, finished: (chat: ChatDraft) => boolean): CreateDraft {
  return {
    ...draft,
    chats: listedChats(draft).map((chat) =>
      chat.open && finished(chat) ? { ...chat, open: false, added: true } : chat,
    ),
  };
}

function inputOf(draft: CreateDraft): string {
  return JSON.stringify([
    draft.name.trim(),
    listedChats(draft).map((chat) => [
      chat.kind,
      memberId(chat),
      chat.projectId,
      chat.provider,
      chat.model,
      chat.agentMode,
      chat.handle,
      chat.text,
      chat.files.map((file) => file.id),
      chat.dependsOn,
      chat.level,
    ]),
  ]);
}

export function hasUnsavedInput(initial: CreateDraft, draft: CreateDraft): boolean {
  return inputOf(initial) !== inputOf(draft);
}
