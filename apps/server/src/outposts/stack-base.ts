import { isStacked } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { storyTaskOf } from '../persistence/outpost-stories.ts';
import type { StoryTaskRow } from './ports.ts';

export interface StackParent {
  parentChatId: string;
  owner: string;
  branch: string | null;
}

export interface StackBase {
  parentChatId: string;
  owner: string;
  branch: string;
}

export const UNNAMED_OWNER = 'the other chat';

export function ownerName(handle: string | null): string {
  return handle ? `@${handle}` : UNNAMED_OWNER;
}

function liveBranch(parent: StoryTaskRow): string | null {
  const ended = parent.pull !== null && parent.pull.state !== 'open';
  return parent.ownsBranch && !ended ? parent.branch : null;
}

export async function stackParentOf(db: Queryable, chatId: string): Promise<StackParent | null> {
  const own = await storyTaskOf(db, chatId);
  const parentChatId = own?.task.dependsOnConversationId ?? null;
  if (!own || parentChatId === null) return null;
  const parent = await storyTaskOf(db, parentChatId);
  if (!parent || !isStacked(own, parent)) return null;
  return { parentChatId, owner: ownerName(parent.handle), branch: liveBranch(parent) };
}

export async function stackBaseOf(db: Queryable, chatId: string): Promise<StackBase | null> {
  const parent = await stackParentOf(db, chatId);
  return parent?.branch ? { ...parent, branch: parent.branch } : null;
}
