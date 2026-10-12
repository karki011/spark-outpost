import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConversationDetail, Project } from '@spark-outpost/contracts';
import { api, queryKeys } from '../../api/client.ts';
import type { usePopover } from '../../ui/use-popover.ts';
import { TalkToChip } from '../../teammates/TalkToChip.tsx';
import { OutpostChip } from '../outpost/OutpostChip.tsx';
import { useOutpostSeam } from '../outpost/outpost-seam.ts';
import { AgentSetup } from './AgentSetup.tsx';
import { AutonomyChip, type AutonomyControl } from './AutonomyChip.tsx';
import { ChatBranch } from './ChatBranch.tsx';
import { ProjectFolders } from './ProjectFolders.tsx';
import { WorkPlaceMenu } from './WorkPlaceMenu.tsx';
import { useProjectBranch } from './use-chat-repos.ts';
import { useChatWorkspace } from './use-chat-workspace.ts';

type RepoPopover = ReturnType<typeof usePopover<HTMLButtonElement, HTMLDivElement>>;

function memberOf(detail: ConversationDetail) {
  return detail.conversation.outpost ?? null;
}

function MemberChip({ conversationId }: { conversationId: string }) {
  const seam = useOutpostSeam();
  const outpost = useQuery({
    queryKey: queryKeys.conversation(conversationId),
    queryFn: () => api.getConversation(conversationId),
    select: memberOf,
  }).data;
  if (!outpost) return null;
  return (
    <OutpostChip
      name={outpost.name}
      handle={outpost.handle}
      onOpen={seam ? () => seam.onOpenOutpost(outpost.id) : undefined}
    />
  );
}

export function ContextBar({
  conversationId,
  repos,
  popover,
  autonomy,
  lead,
  suggestion,
}: {
  conversationId: string;
  repos: Project[];
  popover: RepoPopover;
  autonomy: AutonomyControl | null;
  lead?: ReactNode;
  suggestion?: ReactNode;
}) {
  const primary = repos[0] ?? null;
  const branch = useProjectBranch(primary?.id ?? null);
  const current = useChatWorkspace(conversationId, primary !== null).data?.current ?? null;
  return (
    <ProjectFolders conversationId={conversationId} repos={repos} popover={popover} lead={lead}>
      {!primary && <span className="ctx-unlinked">Not linked, so the agent can't read files</span>}
      {primary && current && (
        <ChatBranch conversationId={conversationId} branch={current} checkoutBranch={branch} />
      )}
      {primary && !current && (
        <WorkPlaceMenu
          conversationId={conversationId}
          projectId={primary.id}
          checkoutBranch={branch}
        />
      )}
      <TalkToChip conversationId={conversationId} />
      <MemberChip conversationId={conversationId} />
      {primary && autonomy && <AutonomyChip {...autonomy} />}
      {primary && <AgentSetup key={primary.id} repos={repos} />}
      {suggestion}
    </ProjectFolders>
  );
}
