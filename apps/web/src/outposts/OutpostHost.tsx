import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import type { Outpost } from '@spark-outpost/contracts';
import { OutpostSeamContext, type OutpostSeam } from '../chat/outpost/outpost-seam.ts';
import { useAddMember, useOutposts } from './use-outposts.ts';

const OutpostCreate = lazy(() =>
  import('./OutpostCreate.tsx').then((module) => ({ default: module.OutpostCreate })),
);

const NO_OUTPOSTS: readonly Outpost[] = [];

interface Creating {
  firstChatId: string | null;
}

interface OutpostHostProps {
  openOutpostId: string | null;
  onOpenOutpost: (outpostId: string, postId?: string) => void;
  children: ReactNode;
}

export function OutpostHost({ openOutpostId, onOpenOutpost, children }: OutpostHostProps) {
  const outposts = useOutposts().data ?? NO_OUTPOSTS;
  const addMember = useAddMember().mutateAsync;
  const [creating, setCreating] = useState<Creating | null>(null);
  const seam = useMemo<OutpostSeam>(
    () => ({
      outposts,
      openOutpostId,
      onOpenOutpost,
      onNewOutpost: (conversationId) => setCreating({ firstChatId: conversationId ?? null }),
      onAddToOutpost: (outpostId, member) => addMember({ outpostId, member }),
    }),
    [outposts, openOutpostId, onOpenOutpost, addMember],
  );
  return (
    <OutpostSeamContext value={seam}>
      {children}
      {creating && (
        <Suspense fallback={null}>
          <OutpostCreate
            firstChatId={creating.firstChatId}
            onCreated={(outpostId) => {
              setCreating(null);
              onOpenOutpost(outpostId);
            }}
            onClose={() => setCreating(null)}
          />
        </Suspense>
      )}
    </OutpostSeamContext>
  );
}
