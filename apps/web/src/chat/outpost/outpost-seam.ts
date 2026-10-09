import { createContext, use } from 'react';
import type { MemberRequest, Outpost } from '@spark-outpost/contracts';

export interface OutpostSeam {
  outposts: readonly Outpost[];
  openOutpostId: string | null;
  canManage: boolean;
  onOpenOutpost: (outpostId: string, postId?: string) => void;
  onNewOutpost: (conversationId?: string) => void;
  onAddToOutpost: (outpostId: string, member: MemberRequest) => Promise<unknown>;
}

export const OutpostSeamContext = createContext<OutpostSeam | null>(null);

export function useOutpostSeam(): OutpostSeam | null {
  return use(OutpostSeamContext);
}
