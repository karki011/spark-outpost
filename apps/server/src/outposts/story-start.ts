import {
  OUTPOST_STORY_TITLE_MAX,
  startMemberChatId,
  storyOrder,
  storyProblems,
  type CreateOutpostRequest,
  type StartMember,
  type StoryProblem,
} from '@spark-outpost/contracts';
import type { NewStoryTask, StoredDraft } from './ports.ts';
import type { StoryRequest } from './post-service.ts';
import type { Refusal } from './post-rules.ts';

export const DRAFT_ALREADY_STARTED = 'That draft was already started.';
export const DRAFT_OTHER_OUTPOST = 'That draft belongs to another outpost.';
export const LEAD_CHAT_GONE = 'The chat that proposed this draft was deleted.';
export const LEAD_NOT_IN_OUTPOST = 'Add the chat that proposed the draft to the outpost first.';
export const LEAD_HAS_FIRST_MESSAGE =
  'The chat that proposed the draft cannot get a first message from itself.';

export function startsAfterUnknown(handle: string): string {
  return `@${handle} starts after a chat that gets no first message in this start.`;
}

export function nothingToHold(handle: string): string {
  return `@${handle} starts after another chat but has no first message to hold.`;
}

export interface StoryLead {
  conversationId: string;
  handle: string;
}

export interface StoryPlan {
  kind: 'plan';
  lead: StoryLead;
  tasks: NewStoryTask[];
  posts: StoryRequest[];
}

interface SubTask {
  member: StartMember;
  conversationId: string;
  firstMessage: NonNullable<StartMember['firstMessage']>;
  position: number;
}

function refusal(message: string): Refusal {
  return { kind: 'refusal', message };
}

function problemLine(problem: StoryProblem): string {
  return problem.kind === 'cycle'
    ? `These chats wait for each other: ${problem.text}.`
    : problem.text;
}

function draftRefusal(draft: StoredDraft, outpostId: string): string | null {
  if (draft.startedAt !== null && draft.outpostId !== outpostId) return DRAFT_ALREADY_STARTED;
  if (draft.outpostId !== null && draft.outpostId !== outpostId) return DRAFT_OTHER_OUTPOST;
  const problem = storyProblems(draft.body.chats)[0];
  return problem ? problemLine(problem) : null;
}

function subTasks(request: CreateOutpostRequest): SubTask[] {
  const found: SubTask[] = [];
  for (const member of request.members) {
    const { firstMessage } = member;
    if (!firstMessage) continue;
    found.push({
      member,
      conversationId: startMemberChatId(member),
      firstMessage,
      position: found.length,
    });
  }
  return found;
}

function edgeRefusal(request: CreateOutpostRequest, tasks: readonly SubTask[]): string | null {
  const known = new Set(tasks.map((task) => task.conversationId));
  for (const member of request.members) {
    if (member.dependsOn === undefined) continue;
    if (!member.firstMessage) return nothingToHold(member.handle);
    if (!known.has(member.dependsOn)) return startsAfterUnknown(member.handle);
  }
  const handles = new Map(tasks.map((task) => [task.conversationId, task.member.handle]));
  const problem = storyProblems(
    tasks.map(({ member }) => {
      const dependsOn = member.dependsOn === undefined ? undefined : handles.get(member.dependsOn);
      return { handle: member.handle, ...(dependsOn === undefined ? {} : { dependsOn }) };
    }),
  )[0];
  return problem ? problemLine(problem) : null;
}

function firstLine(text: string): string {
  const line = text.trim().split('\n', 1)[0]?.trim() ?? '';
  return line.slice(0, OUTPOST_STORY_TITLE_MAX);
}

function titleOf(draft: StoredDraft, task: SubTask): string {
  const proposed = draft.body.chats.find((chat) => chat.handle === task.member.handle);
  return proposed?.title ?? (firstLine(task.firstMessage.text) || draft.title);
}

export function planStory(
  draft: StoredDraft,
  request: CreateOutpostRequest,
  leadHandle: string | null,
): StoryPlan | Refusal {
  if (draft.conversationId === null) return refusal(LEAD_CHAT_GONE);
  const refused = draftRefusal(draft, request.id);
  if (refused !== null) return refusal(refused);
  if (leadHandle === null) return refusal(LEAD_NOT_IN_OUTPOST);
  const lead = { conversationId: draft.conversationId, handle: leadHandle };
  const tasks = subTasks(request);
  if (tasks.some((task) => task.conversationId === lead.conversationId)) {
    return refusal(LEAD_HAS_FIRST_MESSAGE);
  }
  const edge = edgeRefusal(request, tasks);
  if (edge !== null) return refusal(edge);
  const byChat = new Map(tasks.map((task) => [task.conversationId, task]));
  const ordered = storyOrder(
    tasks.map((task) => ({
      conversationId: task.conversationId,
      dependsOn: task.member.dependsOn ?? null,
      position: task.position,
    })),
  ).flatMap((item) => byChat.get(item.conversationId) ?? []);
  return {
    kind: 'plan',
    lead,
    tasks: ordered.map((task) => ({
      conversationId: task.conversationId,
      outpostId: request.id,
      draftId: draft.id,
      leadConversationId: lead.conversationId,
      title: titleOf(draft, task),
      position: task.position,
      dependsOnConversationId: task.member.dependsOn ?? null,
      openingPostId: task.firstMessage.id,
    })),
    posts: ordered.map((task) => ({
      id: task.firstMessage.id,
      outpostId: request.id,
      body: task.firstMessage.text,
      fromConversationId: lead.conversationId,
      fromHandle: lead.handle,
      toHandle: task.member.handle,
      toConversationId: task.conversationId,
      attachmentIds: task.firstMessage.attachmentIds,
      afterPostId:
        task.member.dependsOn === undefined
          ? null
          : (byChat.get(task.member.dependsOn)?.firstMessage.id ?? null),
    })),
  };
}
