import type { KeyboardEvent } from 'react';
import type { GithubInboxItem } from '@spark-outpost/contracts';

const STEPS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

export function moveBetweenRows(
  event: KeyboardEvent<HTMLElement>,
  items: readonly GithubInboxItem[],
  openId: string | null,
  onOpen: (item: GithubInboxItem) => void,
): void {
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
  const item = next.dataset.id ? items.find((entry) => entry.id === next.dataset.id) : undefined;
  if (openId && item) onOpen(item);
}
