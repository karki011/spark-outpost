import './sub-chats-pane.css';
import { useId } from 'react';
import { shownChatTitle, type SubChatRow } from '@spark-outpost/contracts';
import { SubChatStatusWord } from '../conversations/SubChatStatusWord.tsx';
import { Button } from '../ui/Button.tsx';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { useModelNamer, type ModelNamer } from './model-names.ts';
import {
  SUB_CHATS_FOOTER,
  canStartAnyway,
  placementFact,
  pullRequestFact,
  subChatGroups,
  type SubChatGroup,
} from './sub-chats-pane.ts';
import { useStartAnyway, useSubChats } from './use-sub-chats.ts';

interface RowProps {
  row: SubChatRow;
  modelName: ModelNamer;
  starting: boolean;
  onOpenChat: (conversationId: string) => void;
  onStart: (subChatId: string) => void;
}

function PullRequestFact({ row }: { row: SubChatRow }) {
  const pull = row.pullRequest;
  if (!pull) return <span>{pullRequestFact(null)}</span>;
  return (
    <span>
      <a
        href={pull.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Pull request ${pull.number}`}
      >
        #{pull.number}
      </a>{' '}
      · {pullRequestFact(pull)}
    </span>
  );
}

function SubChatCard({ row, modelName, starting, onOpenChat, onStart }: RowProps) {
  const title = shownChatTitle(row.title);
  const placement = placementFact(row);
  const model = modelName(row.startedWith.provider, row.startedWith.model);
  return (
    <li className="scp-row" data-status={row.status}>
      <div className="scp-head">
        <button type="button" className="scp-title" onClick={() => onOpenChat(row.id)}>
          {title}
        </button>
        <SubChatStatusWord status={row.status} />
      </div>
      <p className="scp-facts">
        {row.branch && (
          <>
            <code>{row.branch}</code>
            <span aria-hidden="true"> · </span>
          </>
        )}
        <PullRequestFact row={row} />
        {placement && <span> · {placement}</span>}
        <span> · {model}</span>
      </p>
      <p className="scp-facts">Started by this chat</p>
      {row.why && (
        <p className="scp-why">
          <span>{row.why}</span>
          {row.status === 'needs_you' && (
            <button
              type="button"
              className="scp-open"
              aria-label={`Open ${title}`}
              onClick={() => onOpenChat(row.id)}
            >
              Open ›
            </button>
          )}
        </p>
      )}
      {canStartAnyway(row) && (
        <div className="scp-acts">
          <Button
            tone="line"
            small
            disabled={starting}
            aria-label={`Start anyway: ${title}`}
            onClick={() => onStart(row.id)}
          >
            Start anyway
          </Button>
        </div>
      )}
    </li>
  );
}

interface GroupProps extends Omit<RowProps, 'row'> {
  group: SubChatGroup;
}

function Group({ group, ...rest }: GroupProps) {
  const headingId = useId();
  return (
    <section className="scp-group" aria-labelledby={headingId}>
      <h3 id={headingId}>
        {group.label} <span aria-hidden="true">· </span>
        {group.rows.length}
      </h3>
      <ul>
        {group.rows.map((row) => (
          <SubChatCard key={row.id} row={row} {...rest} />
        ))}
      </ul>
    </section>
  );
}

interface SubChatsPaneProps {
  conversationId: string;
  open: boolean;
  onOpenChat: (conversationId: string) => void;
}

export function SubChatsPane({ conversationId, open, onOpenChat }: SubChatsPaneProps) {
  const subChats = useSubChats(conversationId, open);
  const start = useStartAnyway(conversationId);
  const rows = subChats.data ?? [];
  const modelName = useModelNamer(rows.map((row) => row.startedWith.provider));
  if (!subChats.data) {
    return (
      <div className="wsec">
        <QueryWait query={subChats} what="the sub-chats">
          <Skeleton label="Opening Sub-chats" shape="cards" />
        </QueryWait>
      </div>
    );
  }
  const groups = subChatGroups(rows).filter((group) => group.rows.length > 0);
  return (
    <div className="wsec scp">
      {groups.length === 0 && <p className="wnote first">No sub-chats are left in this chat.</p>}
      {groups.map((group) => (
        <Group
          key={group.status}
          group={group}
          modelName={modelName}
          starting={start.isPending}
          onOpenChat={onOpenChat}
          onStart={start.mutate}
        />
      ))}
      {start.isError && (
        <p className="wnote bad" role="alert">
          {start.error.message}
        </p>
      )}
      <p className="wnote">{SUB_CHATS_FOOTER}</p>
    </div>
  );
}
