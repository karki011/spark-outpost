import type { ReactNode } from 'react';
import type { Project } from '@spark-outpost/contracts';
import type { usePopover } from '../../ui/use-popover.ts';
import { TalkToChip } from '../../teammates/TalkToChip.tsx';
import { AgentSetup } from './AgentSetup.tsx';
import { AutonomyChip, type AutonomyControl } from './AutonomyChip.tsx';
import { ChatBranch } from './ChatBranch.tsx';
import { ProjectFolders } from './ProjectFolders.tsx';
import { WorkPlaceMenu } from './WorkPlaceMenu.tsx';
import { useProjectBranch } from './use-chat-repos.ts';
import { useChatWorkspace } from './use-chat-workspace.ts';

type RepoPopover = ReturnType<typeof usePopover<HTMLButtonElement, HTMLDivElement>>;

export function ContextBar({
  conversationId,
  repos,
  popover,
  autonomy,
  suggestion,
}: {
  conversationId: string;
  repos: Project[];
  popover: RepoPopover;
  autonomy: AutonomyControl | null;
  suggestion?: ReactNode;
}) {
  const primary = repos[0] ?? null;
  const branch = useProjectBranch(primary?.id ?? null);
  const current = useChatWorkspace(conversationId, primary !== null).data?.current ?? null;
  return (
    <ProjectFolders conversationId={conversationId} repos={repos} popover={popover}>
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
      {primary && autonomy && <AutonomyChip {...autonomy} />}
      {primary && <AgentSetup key={primary.id} repos={repos} />}
      {suggestion}
    </ProjectFolders>
  );
}
