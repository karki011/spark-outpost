import { Fragment } from 'react';
import type { SparkAction, StartOutpostAction, StartOutpostChat } from '@spark-outpost/contracts';
import { useOutpostSeam } from '../outpost/outpost-seam.ts';

function placeOf(chat: StartOutpostChat): string {
  if (chat.dependsOn === null) return 'Parallel';
  return chat.stacked ? `Stacked on @${chat.dependsOn}` : `Starts after @${chat.dependsOn}`;
}

function detailOf(chat: StartOutpostChat): string {
  const parts = [chat.project ?? 'No project', placeOf(chat)];
  if (chat.existing) parts.unshift('Existing chat · gets a request');
  if (chat.agentMode) parts.push(`Mode: ${chat.agentMode}`);
  return parts.join(' · ');
}

export function OutpostStartFacts({ action }: { action: StartOutpostAction }) {
  const seam = useOutpostSeam();
  const onEdit = seam?.canManage ? seam.onOpenDraft : undefined;
  return (
    <>
      <dl className="sac-facts">
        <dt>{action.joining ? 'Outpost' : 'New outpost'}</dt>
        <dd>{action.outpostName}</dd>
        {action.chats.map((chat) => (
          <Fragment key={chat.handle}>
            <dt>@{chat.handle}</dt>
            <dd>
              <b>{chat.title}</b> · {detailOf(chat)}
              <br />
              {chat.task}
            </dd>
          </Fragment>
        ))}
      </dl>
      {onEdit && (
        <button
          type="button"
          className="btn ghost sm sac-edit"
          onClick={() => onEdit(action.draftId)}
        >
          Edit
        </button>
      )}
    </>
  );
}

export function outpostStartByline(action: SparkAction, agent: string): string | null {
  if (action.action !== 'start_outpost') return null;
  return `${agent} wants to start ${action.chats.length === 1 ? 'a sub-chat' : `${action.chats.length} sub-chats`} for this work.`;
}

export function outpostStartNote(action: SparkAction): string | null {
  if (action.action !== 'start_outpost') return null;
  return 'Nothing is created until you start it. Each chat runs in a mode no higher than this one, and its first message is the agent’s text, not yours. Edit opens the draft on your Mac.';
}
