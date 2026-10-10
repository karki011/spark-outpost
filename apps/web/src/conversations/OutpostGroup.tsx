import type { ReactNode } from 'react';
import type { Outpost } from '@spark-outpost/contracts';
import { ChevronIcon, OutpostIcon } from '../ui/icons.tsx';
import { memberCount } from './AddToOutpost.tsx';

function needsYouLabel(count: number): string {
  return count === 1 ? '1 needs you' : `${count} need you`;
}

interface OutpostGroupProps {
  outpost: Outpost;
  current: boolean;
  open: boolean;
  count: number;
  onOpen: () => void;
  onToggle: () => void;
  children: ReactNode;
}

export function OutpostGroup({
  outpost,
  current,
  open,
  count,
  onOpen,
  onToggle,
  children,
}: OutpostGroupProps) {
  const bodyId = `obody-${outpost.id}`;
  const hasChats = count > 0;
  const shown = hasChats && open;
  return (
    <li className={shown ? 'pblock op-block open' : 'pblock op-block'} data-outpost={outpost.id}>
      <div className={current ? 'proj op-row active' : 'proj op-row'}>
        {hasChats ? (
          <button
            type="button"
            className="op-fold"
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={`${memberCount(count)} in ${outpost.name}`}
            title={open ? 'Hide chats' : 'Show chats'}
            onClick={onToggle}
          >
            <ChevronIcon />
          </button>
        ) : (
          <span className="op-fold" aria-hidden="true" />
        )}
        <button
          type="button"
          className="proj-head"
          aria-label={
            outpost.needsYou > 0 ? `${outpost.name}, ${needsYouLabel(outpost.needsYou)}` : undefined
          }
          aria-current={current ? 'page' : undefined}
          onClick={onOpen}
        >
          <OutpostIcon />
          <span className="nm">{outpost.name}</span>
          {hasChats && (
            <span className="c" aria-hidden="true">
              {count}
            </span>
          )}
          {outpost.needsYou > 0 && (
            <span className="op-needs" title={`Needs you: ${outpost.needsYou}`}>
              {outpost.needsYou}
            </span>
          )}
        </button>
      </div>
      {hasChats && (
        <div className="pbody" id={bodyId} inert={!open}>
          <div>{children}</div>
        </div>
      )}
    </li>
  );
}
