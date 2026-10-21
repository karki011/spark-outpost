import { useId, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConversationDetail, Project } from '@spark-outpost/contracts';
import { api, queryKeys } from '../../api/client.ts';
import { useRemoteClient } from '../../phone/use-remote-client.ts';
import { usePhone } from '../../ui/breakpoints.ts';
import { DotsIcon } from '../../ui/icons.tsx';
import type { usePopover } from '../../ui/use-popover.ts';
import { TalkToChip } from '../../teammates/TalkToChip.tsx';
import { OutpostChip } from '../outpost/OutpostChip.tsx';
import { useOutpostSeam } from '../outpost/outpost-seam.ts';
import { AgentSetup, useSetupAttention } from './AgentSetup.tsx';
import { ChatBranch } from './ChatBranch.tsx';
import { ChatCache } from './ChatCache.tsx';
import { ProjectFolders } from './ProjectFolders.tsx';
import { showsPlaceMenu } from './place-picker-model.ts';
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

interface DetailsChipProps {
  open: boolean;
  controls: string;
  attention: boolean;
  onToggle: () => void;
}

function DetailsChip({ open, controls, attention, onToggle }: DetailsChipProps) {
  return (
    <button
      type="button"
      className="ctx-details"
      aria-label={attention ? 'Chat details, agent setup needs a look' : 'Chat details'}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      <DotsIcon />
      {attention && <span className="ctx-dot" aria-hidden="true" />}
    </button>
  );
}

export function ContextBar({
  conversationId,
  repos,
  popover,
  lead,
  suggestion,
}: {
  conversationId: string;
  repos: Project[];
  popover: RepoPopover;
  lead?: ReactNode;
  suggestion?: ReactNode;
}) {
  const primary = repos[0] ?? null;
  const branch = useProjectBranch(primary?.id ?? null);
  const workspace = useChatWorkspace(conversationId, primary !== null).data;
  const current = workspace?.current ?? null;
  const phone = usePhone();
  const { allows } = useRemoteClient();
  const setup = primary !== null && allows('settings');
  const attention = useSetupAttention(phone && setup ? primary.id : null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  const branchChip = primary && current && (
    <ChatBranch conversationId={conversationId} branch={current} checkoutBranch={branch} />
  );
  const placeMenu = primary && showsPlaceMenu(workspace, branch) && (
    <WorkPlaceMenu conversationId={conversationId} projectId={primary.id} checkoutBranch={branch} />
  );
  const setupChip = setup && <AgentSetup key={primary.id} repos={repos} labelled={phone} />;
  const hasDetails = Boolean(branchChip) || Boolean(placeMenu) || setup;

  if (phone) {
    return (
      <ProjectFolders
        conversationId={conversationId}
        repos={repos}
        popover={popover}
        lead={lead}
        details={{
          id: detailsId,
          open: detailsOpen,
          folder: Boolean(branchChip),
          items: (
            <>
              {placeMenu}
              {setupChip}
            </>
          ),
        }}
      >
        {branchChip}
        <TalkToChip conversationId={conversationId} />
        <MemberChip conversationId={conversationId} />
        {hasDetails && (
          <DetailsChip
            open={detailsOpen}
            controls={detailsId}
            attention={attention && !detailsOpen}
            onToggle={() => setDetailsOpen((open) => !open)}
          />
        )}
        {suggestion}
      </ProjectFolders>
    );
  }

  return (
    <ProjectFolders conversationId={conversationId} repos={repos} popover={popover} lead={lead}>
      {!primary && <span className="ctx-unlinked">Not linked, so the agent has no file tools</span>}
      {branchChip}
      {placeMenu}
      <TalkToChip conversationId={conversationId} />
      <MemberChip conversationId={conversationId} />
      {setupChip}
      <ChatCache conversationId={conversationId} />
      {suggestion}
    </ProjectFolders>
  );
}
