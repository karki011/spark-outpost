import { z } from 'zod';
import { chatRefSchema } from './chat-ref.ts';
import { involvementLevelSchema } from './involvement-levels.ts';
import { providerIdSchema } from './provider-ids.ts';

export const SUB_CHAT_TITLE_MAX = 100;
export const SUB_CHAT_TASK_MAX = 20_000;
export const SUB_CHATS_STARTED_ACTIVITY = 'sub_chats_started';

const choice = z.string().min(1).max(200);

export const plannedSubChatSchema = z.object({
  conversationId: z.uuid(),
  title: z.string().min(1).max(SUB_CHAT_TITLE_MAX),
  task: z.string().min(1).max(SUB_CHAT_TASK_MAX),
  project: z.object({ id: z.uuid(), name: z.string() }),
  provider: providerIdSchema,
  agentName: z.string().max(200),
  model: choice.nullable(),
  effort: choice.nullable(),
  agentMode: choice.nullable(),
  level: involvementLevelSchema.nullable(),
  sameAsParent: z.boolean(),
  stackedOn: z.uuid().nullable(),
  startsAfter: z.array(z.uuid()),
});
export type PlannedSubChat = z.infer<typeof plannedSubChatSchema>;

export const startSubChatsActionSchema = z.object({
  action: z.literal('start_sub_chats'),
  parent: chatRefSchema,
  pieces: z.array(plannedSubChatSchema).min(1),
});
export type StartSubChatsAction = z.infer<typeof startSubChatsActionSchema>;

export const stopSubChatActionSchema = z.object({
  action: z.literal('stop_sub_chat'),
  parent: chatRefSchema,
  subChat: chatRefSchema,
});
export type StopSubChatAction = z.infer<typeof stopSubChatActionSchema>;

export const subChatEditSchema = z.object({
  id: z.uuid(),
  model: choice.nullable().optional(),
  effort: choice.nullable().optional(),
});
export type SubChatEdit = z.infer<typeof subChatEditSchema>;

export const subChatsStartedActivitySchema = z.object({
  subChats: z.array(chatRefSchema.extend({ held: z.boolean() })),
  notStarted: z.array(z.object({ title: z.string(), reason: z.string() })),
});
export type SubChatsStartedActivity = z.infer<typeof subChatsStartedActivitySchema>;

export const subChatActionLabels = {
  start_sub_chats: {
    question: 'Start these sub-chats?',
    confirm: 'Start',
    doing: 'Starting the sub-chats…',
  },
  stop_sub_chat: {
    question: 'Stop this sub-chat?',
    confirm: 'Stop',
    doing: 'Stopping…',
  },
};

function countNoun(count: number): string {
  return `${count} ${count === 1 ? 'sub-chat' : 'sub-chats'}`;
}

export function subChatActionQuestion(action: StartSubChatsAction | StopSubChatAction): string {
  if (action.action === 'stop_sub_chat') return `Stop “${action.subChat.title}”?`;
  return `Start ${countNoun(action.pieces.length)}?`;
}

export function applySubChatEdits(
  action: StartSubChatsAction,
  edits: readonly SubChatEdit[],
): StartSubChatsAction {
  const byId = new Map(edits.map((edit) => [edit.id, edit]));
  return {
    ...action,
    pieces: action.pieces.map((piece) => {
      const edit = byId.get(piece.conversationId);
      if (!edit) return piece;
      return {
        ...piece,
        ...(edit.model === undefined ? {} : { model: edit.model }),
        ...(edit.effort === undefined ? {} : { effort: edit.effort }),
        sameAsParent: false,
      };
    }),
  };
}

export function subChatPlacement(piece: PlannedSubChat, pieces: readonly PlannedSubChat[]): string {
  const number = (id: string) => pieces.findIndex((other) => other.conversationId === id) + 1;
  if (piece.stackedOn) return `Stacked on ${number(piece.stackedOn)}`;
  if (piece.startsAfter.length === 0) return 'New branch';
  return `Starts after ${piece.startsAfter.map(number).join(', ')}`;
}

export function subChatActionAuditFacts(action: StartSubChatsAction | StopSubChatAction) {
  if (action.action === 'stop_sub_chat') return action;
  return {
    action: action.action,
    parent: action.parent,
    pieces: action.pieces.map((piece) => ({
      conversationId: piece.conversationId,
      title: piece.title,
      project: piece.project.name,
      provider: piece.provider,
      model: piece.model,
      effort: piece.effort,
      agentMode: piece.agentMode,
      level: piece.level,
      stackedOn: piece.stackedOn,
      startsAfter: piece.startsAfter,
    })),
  };
}
