import { z } from 'zod';
import {
  OUTPOST_HANDLE_PATTERN,
  OUTPOST_MEMBERS_MAX,
  OUTPOST_NAME_MAX,
  OUTPOST_STORY_TITLE_MAX,
} from './outpost-limits.ts';

export const START_OUTPOST_TASK_MAX = 300;

const handle = z.string().regex(OUTPOST_HANDLE_PATTERN);

export const startOutpostChatSchema = z.object({
  handle,
  title: z.string().max(OUTPOST_STORY_TITLE_MAX),
  project: z.string().max(200).nullable(),
  agentMode: z.string().max(200).nullable(),
  dependsOn: handle.nullable(),
  stacked: z.boolean(),
  existing: z.boolean().default(false),
  task: z.string().max(START_OUTPOST_TASK_MAX),
});
export type StartOutpostChat = z.infer<typeof startOutpostChatSchema>;

export const startOutpostActionSchema = z.object({
  action: z.literal('start_outpost'),
  draftId: z.uuid(),
  outpostName: z.string().max(OUTPOST_NAME_MAX),
  joining: z.boolean(),
  title: z.string().max(OUTPOST_STORY_TITLE_MAX),
  chats: z.array(startOutpostChatSchema).min(1).max(OUTPOST_MEMBERS_MAX),
});
export type StartOutpostAction = z.infer<typeof startOutpostActionSchema>;

export const startOutpostLabels = {
  start_outpost: {
    question: 'Start these sub-chats?',
    confirm: 'Start',
    doing: 'Starting the chats…',
  },
};

export function startedOutpostLine(outpostName: string, chats: number): string {
  return `Started outpost ${outpostName} with ${chats} ${chats === 1 ? 'chat' : 'chats'}.`;
}
