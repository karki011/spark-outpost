import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { SlashItem } from './slash.ts';
import { slashOptionId } from './use-slash.ts';

interface SlashMenuProps {
  listId: string;
  items: readonly SlashItem[];
  active: number;
  agentName: string;
  emptyNote: string | null;
  onActive: (index: number) => void;
  onPick: (item: SlashItem) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export function SlashMenu({
  listId,
  items,
  active,
  agentName,
  emptyNote,
  onActive,
  onPick,
  onKeyDown,
}: SlashMenuProps) {
  const current = items[active];
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current
      ?.querySelector(`#${CSS.escape(slashOptionId(listId, active))}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [listId, active]);

  return (
    <div className="mpop left filepop mentionpop slashpop open">
      <div
        ref={listRef}
        id={listId}
        className="flist"
        role="listbox"
        aria-label="Commands"
        aria-activedescendant={current ? slashOptionId(listId, active) : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {items.map((item, index) => (
          <div
            key={`${item.source}:${item.name}`}
            id={slashOptionId(listId, index)}
            className="fopt"
            role="option"
            aria-selected={index === active}
            onPointerDown={(event) => event.preventDefault()}
            onPointerMove={() => {
              if (index !== active) onActive(index);
            }}
            onClick={() => onPick(item)}
          >
            <span className="fname">
              <b>
                /{item.name}
                {item.hint && <span className="slash-hint"> {item.hint}</span>}
              </b>
              <small>{item.description}</small>
            </span>
            <small className="slash-source">{item.source === 'client' ? 'Spark' : agentName}</small>
          </div>
        ))}
      </div>
      {current ? (
        <p className="slash-detail" aria-live="polite">
          {current.detail}
        </p>
      ) : (
        <p className="mempty" role="status">
          {emptyNote ?? 'No matching commands. Enter sends it as text.'}
        </p>
      )}
    </div>
  );
}
