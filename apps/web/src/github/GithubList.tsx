import { useState, type KeyboardEvent } from 'react';
import type { GithubInboxGroup, GithubInboxItem } from '@spark-outpost/contracts';
import { GROUP_LABEL, listEntries } from './github-model.ts';
import { BotsRow, GithubRow } from './GithubRow.tsx';
import { moveBetweenRows } from './row-keys.ts';

interface GithubListProps {
  group: GithubInboxGroup;
  items: GithubInboxItem[];
  openId: string | null;
  now: number;
  onOpen: (item: GithubInboxItem) => void;
  onOpenChat: (conversationId: string) => void;
}

const EMPTY: Record<GithubInboxGroup, string> = {
  review_requested: 'No one is waiting on your review.',
  needs_fixes: 'None of your pull requests need fixes.',
  ready_to_merge: 'Nothing is ready to merge yet.',
  waiting: 'None of your pull requests are waiting on others.',
};

export function GithubList({ group, items, openId, now, onOpen, onOpenChat }: GithubListProps) {
  const [botsOpen, setBotsOpen] = useState(() =>
    items.some((item) => item.authorIsBot && item.id === openId),
  );
  const entries = listEntries(group, items);
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) =>
    moveBetweenRows(event, items, openId, onOpen);

  if (items.length === 0) {
    return (
      <p className="gh-none" role="status">
        {EMPTY[group]}
      </p>
    );
  }

  return (
    <ul className="gh-rows" aria-label={GROUP_LABEL[group]} onKeyDown={onKeyDown}>
      {entries.map((entry) => {
        if (entry.kind === 'item') {
          return (
            <GithubRow
              key={entry.item.id}
              item={entry.item}
              selected={entry.item.id === openId}
              now={now}
              onOpen={onOpen}
              onOpenChat={onOpenChat}
            />
          );
        }
        return [
          <BotsRow
            key="bots"
            items={entry.items}
            expanded={botsOpen}
            now={now}
            onToggle={() => setBotsOpen((open) => !open)}
          />,
          ...(botsOpen
            ? entry.items.map((item) => (
                <GithubRow
                  key={item.id}
                  item={item}
                  nested
                  selected={item.id === openId}
                  now={now}
                  onOpen={onOpen}
                  onOpenChat={onOpenChat}
                />
              ))
            : []),
        ];
      })}
    </ul>
  );
}
