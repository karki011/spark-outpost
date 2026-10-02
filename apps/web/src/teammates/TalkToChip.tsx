import { useId } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TeammateTag } from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { ChevronIcon } from '../ui/icons.tsx';
import { usePopover } from '../ui/use-popover.ts';
import { TeammateFace } from './TeammateFace.tsx';
import { teammatesApi } from './teammates-api.ts';
import { useTeammates } from './use-teammates.ts';

interface TalkToChipProps {
  conversationId: string;
  teammate: TeammateTag | null;
}

export function TalkToChip({ conversationId, teammate }: TalkToChipProps) {
  const menuId = useId();
  const client = useQueryClient();
  const { teammates } = useTeammates();
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
  if (teammates.length === 0 && !teammate) return null;

  const choose = (teammateId: string | null) => {
    setOpen(false);
    anchorRef.current?.focus();
    if (teammateId !== (teammate?.id ?? null)) pick.mutate(teammateId);
  };

  return (
    <div className="tm-talk">
      <button
        ref={anchorRef}
        type="button"
        className={teammate ? 'tm-chip on' : 'tm-chip'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={pick.isPending}
        onClick={toggle}
      >
        {teammate ? (
          <>
            <TeammateFace face={teammate.face} size={18} />
            <span>Talking to {teammate.name}</span>
          </>
        ) : (
          <span>Talk to…</span>
        )}
        <ChevronIcon />
      </button>
      <div
        ref={panelRef}
        id={menuId}
        role="menu"
        aria-label="Talk to"
        className={open ? 'tm-menu open' : 'tm-menu'}
        hidden={!open}
      >
        <button
          type="button"
          role="menuitemradio"
          aria-checked={teammate === null}
          onClick={() => choose(null)}
        >
          <span className="tm-menu-blank" aria-hidden="true" />
          <span>
            <b>No Spark</b>
            <small>A plain chat with your defaults</small>
          </span>
        </button>
        {teammates.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="menuitemradio"
            aria-checked={entry.id === teammate?.id}
            onClick={() => choose(entry.id)}
          >
            <TeammateFace face={entry.face} size={22} state={entry.state} />
            <span>
              <b>{entry.name}</b>
              <small>{entry.role || 'Spark'}</small>
            </span>
          </button>
        ))}
      </div>
      {pick.isError && (
        <span className="tm-error" role="alert">
          {pick.error.message}
        </span>
      )}
    </div>
  );
}
