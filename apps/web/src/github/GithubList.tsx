import { useState, type KeyboardEvent } from 'react';
import type { GithubInboxGroup, GithubInboxItem } from '@spark-outpost/contracts';
import { GROUP_LABEL, listEntries } from './github-model.ts';
import { BotsRow, GithubRow } from './GithubRow.tsx';

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

const STEPS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

export function GithubList({ group, items, openId, now, onOpen, onOpenChat }: GithubListProps) {
  const [botsOpen, setBotsOpen] = useState(false);
  const entries = listEntries(group, items);
  const byId = new Map(items.map((item) => [item.id, item]));

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.matches('.gh-main')) return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.gh-main')];
    const at = rows.indexOf(target);
    const next =
      event.key === 'Home'
        ? rows[0]
        : event.key === 'End'
          ? rows.at(-1)
          : STEPS[event.key]
            ? rows[at + STEPS[event.key]!]
            : undefined;
    if (!next) return;
    event.preventDefault();
    next.focus();
    const item = next.dataset.id ? byId.get(next.dataset.id) : undefined;
    if (openId && item) onOpen(item);
  };

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
