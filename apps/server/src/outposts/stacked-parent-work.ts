import type { ShipDeps } from '../ship/prepare.ts';
import { stackParentOf as subChatStackParentOf } from '../sub-chats/stack-base.ts';
import { commitKeptWork } from '../sub-chats/stacked-parent-work.ts';
import type { StoredPost } from './ports.ts';
import { stackParentOf } from './stack-base.ts';

export type ParentWorkReady = (held: StoredPost, awaited: StoredPost) => Promise<boolean>;

export function parentWorkCommitter(deps: ShipDeps): ParentWorkReady {
  return async (held, awaited) => {
    const childChatId = held.toConversationId;
    if (childChatId === null || awaited.toConversationId === null) return true;
    const parent =
      (await subChatStackParentOf(deps.db, childChatId)) ??
      (await stackParentOf(deps.db, childChatId));
    if (!parent || parent.parentChatId !== awaited.toConversationId) return true;
    if (parent.branch === null) return true;
    return commitKeptWork(deps, parent.parentChatId, parent.branch);
  };
}
