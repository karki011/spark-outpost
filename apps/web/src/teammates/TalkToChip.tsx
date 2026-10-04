import { useId } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConversationDetail } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { ChevronIcon, TickIcon } from '../ui/icons.tsx';
import { usePopover } from '../ui/use-popover.ts';
import { TeammateFace } from './TeammateFace.tsx';
import { teammatesApi } from './teammates-api.ts';
import { useTeammates } from './use-teammates.ts';

function talkState(detail: ConversationDetail) {
  return { teammate: detail.conversation.teammate ?? null, started: detail.messages.length > 0 };
}

export function TalkToChip({ conversationId }: { conversationId: string }) {
  const menuId = useId();
  const client = useQueryClient();
  const { teammates } = useTeammates();
  const chat = useQuery({
    queryKey: queryKeys.conversation(conversationId),
    queryFn: () => api.getConversation(conversationId),
    select: talkState,
  });
  const { open, setOpen, toggle, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const pick = useMutation({
    mutationFn: (teammateId: string | null) => teammatesApi.talkTo(conversationId, teammateId),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) }),
        client.invalidateQueries({ queryKey: queryKeys.agentCommands(conversationId) }),
      ]),
  });
  const teammate = chat.data?.teammate ?? null;
  if (!chat.data || chat.data.started) return null;
  if (teammates.length === 0 && !teammate) return null;

  const choose = (teammateId: string | null) => {
    setOpen(false);
    anchorRef.current?.focus();
    if (teammateId !== (teammate?.id ?? null)) pick.mutate(teammateId);
  };

  return (
    <span className="ctx-talk">
      <button
        ref={anchorRef}
        type="button"
        className={teammate ? 'ctx-repo ctx-talk-chip' : 'ctx-repo ctx-talk-chip unset'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={pick.isPending}
        onClick={toggle}
      >
        {teammate ? (
          <TeammateFace face={teammate.face} size={16} />
        ) : (
          <span className="tm-menu-blank sm" aria-hidden="true" />
        )}
        <span className="ctx-name">{teammate ? `Talking to ${teammate.name}` : 'Talk to…'}</span>
        <ChevronIcon />
      </button>
      <div
        ref={panelRef}
        id={menuId}
        role="menu"
        aria-label="Talk to"
        className={open ? 'mpop left talkpop open' : 'mpop left talkpop'}
      >
        <div className="mgroup">Talk to</div>
        <button
          type="button"
          role="menuitemradio"
          className="mopt"
          aria-checked={teammate === null}
          onClick={() => choose(null)}
        >
          <span className="mi">
            <span className="tm-menu-blank" aria-hidden="true" />
          </span>
          <span>
            <b>No Spark</b>
            <small>A plain chat with your defaults</small>
          </span>
          <TickIcon />
        </button>
        {teammates.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="menuitemradio"
            className="mopt"
            aria-checked={entry.id === teammate?.id}
            onClick={() => choose(entry.id)}
          >
            <span className="mi">
              <TeammateFace face={entry.face} size={22} state={entry.state} />
            </span>
            <span>
              <b>{entry.name}</b>
              <small>{entry.role || 'Spark'}</small>
            </span>
            <TickIcon />
          </button>
        ))}
      </div>
      {pick.isError && (
        <span className="ctx-unlinked" role="alert">
          {pick.error.message}
        </span>
      )}
    </span>
  );
}
