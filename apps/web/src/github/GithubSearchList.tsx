import type { KeyboardEvent } from 'react';
import type { GithubInboxGroup, GithubInboxItem } from '@spark-outpost/contracts';
import { GROUP_LABEL, GROUPS, sortItems } from './github-model.ts';
import type { ItemMatch } from './github-search.ts';
import { GithubRow } from './GithubRow.tsx';
import { moveBetweenRows } from './row-keys.ts';

interface GithubSearchListProps {
  matches: readonly ItemMatch[];
  groups: readonly GithubInboxGroup[];
  terms: readonly string[];
  openId: string | null;
  now: number;
  onOpen: (item: GithubInboxItem) => void;
  onOpenChat: (conversationId: string) => void;
}

export function GithubSearchList(props: GithubSearchListProps) {
  const { matches, terms, openId, now, onOpen, onOpenChat } = props;
  const items = matches.map((match) => match.item);
  const hiddenOf = new Map(matches.map((match) => [match.item.id, match.hidden]));
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) =>
    moveBetweenRows(event, items, openId, onOpen);
  const sections = GROUPS.filter((group) => props.groups.includes(group))
    .map((group) => ({
      group,
      items: sortItems(
        group,
        items.filter((item) => item.group === group),
      ),
    }))
    .filter((section) => section.items.length > 0);

  if (sections.length === 0) {
    return (
      <p className="gh-none" role="status">
        No pull requests match.
      </p>
    );
  }

  return (
    <div className="gh-results" onKeyDown={onKeyDown}>
      {sections.map((section) => {
        const headingId = `gh-results-${section.group}`;
        return (
          <section key={section.group} aria-labelledby={headingId}>
            <h3 id={headingId} className="gh-results-head">
              {GROUP_LABEL[section.group]} · {section.items.length}
            </h3>
            <ul className="gh-rows" aria-labelledby={headingId}>
              {section.items.map((item) => (
                <GithubRow
                  key={item.id}
                  item={item}
                  selected={item.id === openId}
                  now={now}
                  terms={terms}
                  hidden={hiddenOf.get(item.id) ?? null}
                  onOpen={onOpen}
                  onOpenChat={onOpenChat}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
