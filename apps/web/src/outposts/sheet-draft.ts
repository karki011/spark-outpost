import {
  OUTPOST_MEMBERS_MAX,
  OUTPOST_NAME_MAX,
  handleProblem,
  suggestHandle,
  type ConversationSummary,
  type MemberRequest,
  type Outpost,
} from '@spark-outpost/contracts';

interface SheetMember {
  conversationId: string;
  handle: string;
}

export interface SheetForm {
  name: string;
  members: SheetMember[];
}

export interface Problem {
  field: 'name' | 'members' | 'handle';
  conversationId: string | null;
  message: string;
}

export interface SheetChanges {
  name: string | null;
  put: MemberRequest[];
  remove: string[];
}

interface ChatChoice {
  chat: ConversationSummary;
  unavailableReason: string | null;
}

export const EMPTY_FORM: SheetForm = { name: '', members: [] };

export function formOf(outpost: Outpost): SheetForm {
  return {
    name: outpost.name,
    members: [...outpost.members]
      .sort((a, b) => a.position - b.position)
      .map((member) => ({ conversationId: member.conversationId, handle: member.handle })),
  };
}

function joinBlock(chat: ConversationSummary, outpostId: string | null): string | null {
  if (chat.sessionType === 'terminal') return 'Terminal sessions cannot join an outpost';
  if (chat.outpost && chat.outpost.id !== outpostId) return `Already in ${chat.outpost.name}`;
  return null;
}

function nameProblem(name: string): Problem | null {
  const trimmed = name.trim();
  if (trimmed === '') return { field: 'name', conversationId: null, message: 'Enter a name.' };
  if (trimmed.length > OUTPOST_NAME_MAX) {
    return {
      field: 'name',
      conversationId: null,
      message: `A name can have at most ${OUTPOST_NAME_MAX} characters.`,
    };
  }
  return null;
}

function memberProblem(
  member: SheetMember,
  form: SheetForm,
  chats: readonly ConversationSummary[],
  outpostId: string | null,
): Problem | null {
  const conversationId = member.conversationId;
  const chat = chats.find((candidate) => candidate.id === conversationId);
  if (!chat) {
    return { field: 'members', conversationId, message: 'This chat no longer exists. Remove it.' };
  }
  const blocked = joinBlock(chat, outpostId);
  if (blocked) {
    return { field: 'members', conversationId, message: `${blocked}. Remove it.` };
  }
  const taken = form.members
    .filter((other) => other.conversationId !== conversationId)
    .map((other) => other.handle);
  const message = handleProblem(member.handle, taken);
  return message ? { field: 'handle', conversationId, message } : null;
}

export function sheetProblems(
  form: SheetForm,
  chats: readonly ConversationSummary[],
  outpostId: string | null = null,
): Problem[] {
  const problems: Problem[] = [];
  const name = nameProblem(form.name);
  if (name) problems.push(name);
  if (form.members.length > OUTPOST_MEMBERS_MAX) {
    problems.push({
      field: 'members',
      conversationId: null,
      message: `An outpost can have at most ${OUTPOST_MEMBERS_MAX} chats.`,
    });
  }
  for (const member of form.members) {
    const problem = memberProblem(member, form, chats, outpostId);
    if (problem) problems.push(problem);
  }
  return problems;
}

export function chatChoices(
  form: SheetForm,
  chats: readonly ConversationSummary[],
  outpostId: string | null = null,
): ChatChoice[] {
  const chosen = new Set(form.members.map((member) => member.conversationId));
  return chats
    .filter((chat) => !chosen.has(chat.id) && !chat.archivedAt)
    .map((chat) => ({ chat, unavailableReason: joinBlock(chat, outpostId) }));
}

export function withMember(
  form: SheetForm,
  chat: ConversationSummary,
  projectNames: Readonly<Record<string, string>>,
): SheetForm {
  if (form.members.some((member) => member.conversationId === chat.id)) return form;
  const projectName = chat.projectIds.map((id) => projectNames[id]).find(Boolean);
  const taken = form.members.map((member) => member.handle);
  const handle = suggestHandle(projectName ?? chat.title, taken);
  return { ...form, members: [...form.members, { conversationId: chat.id, handle }] };
}

export function withoutMember(form: SheetForm, conversationId: string): SheetForm {
  return {
    ...form,
    members: form.members.filter((member) => member.conversationId !== conversationId),
  };
}

export function withHandleFor(form: SheetForm, conversationId: string, typed: string): SheetForm {
  const handle = typed.replace(/^@+/, '').toLowerCase();
  return {
    ...form,
    members: form.members.map((member) =>
      member.conversationId === conversationId ? { ...member, handle } : member,
    ),
  };
}

export function sheetChanges(initial: SheetForm, form: SheetForm): SheetChanges {
  const before = new Map(initial.members.map((member) => [member.conversationId, member.handle]));
  const kept = new Set(form.members.map((member) => member.conversationId));
  const name = form.name.trim();
  return {
    name: name === initial.name.trim() ? null : name,
    put: form.members.filter((member) => before.get(member.conversationId) !== member.handle),
    remove: initial.members
      .map((member) => member.conversationId)
      .filter((conversationId) => !kept.has(conversationId)),
  };
}

export function hasChanges(changes: SheetChanges): boolean {
  return changes.name !== null || changes.put.length > 0 || changes.remove.length > 0;
}
