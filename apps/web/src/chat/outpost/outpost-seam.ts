import { createContext, use } from 'react';
import type { MemberRequest, Outpost } from '@spark-outpost/contracts';

export interface OutpostSeam {
  outposts: readonly Outpost[];
  openOutpostId: string | null;
  canManage: boolean;
  onOpenOutpost: (outpostId: string, postId?: string, thread?: boolean) => void;
  onNewOutpost: (conversationId?: string) => void;
  onOpenDraft?: ((draftId: string) => void) | undefined;
  onAddToOutpost: (outpostId: string, member: MemberRequest) => Promise<unknown>;
}

export function memberChatId(
  outposts: readonly Outpost[],
  outpostId: string,
  handle: string | null,
): string | null {
  if (!handle) return null;
  const members = outposts.find((outpost) => outpost.id === outpostId)?.members ?? [];
  return members.find((member) => member.handle === handle)?.conversationId ?? null;
}

export const OutpostSeamContext = createContext<OutpostSeam | null>(null);

export function useOutpostSeam(): OutpostSeam | null {
  return use(OutpostSeamContext);
}
