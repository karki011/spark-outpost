import './outpost-rows.css';
import type { Outpost } from '@spark-outpost/contracts';
import { OutpostIcon, PlusIcon } from '../ui/icons.tsx';

export function needsYouLabel(count: number): string {
  return count === 1 ? '1 needs you' : `${count} need you`;
}

interface OutpostRowsProps {
  outposts: readonly Outpost[];
  openId: string | null;
  onOpen: (outpostId: string) => void;
  onNew: () => void;
}

export function OutpostRows({ outposts, openId, onOpen, onNew }: OutpostRowsProps) {
  return (
    <section aria-label="Outposts">
      <div className="sec">
        <span>Outposts</span>
        <button
          type="button"
          className="icon-btn"
          aria-label="New outpost"
          title="New outpost"
          onClick={onNew}
        >
          <PlusIcon />
        </button>
      </div>
      {outposts.length > 0 && (
        <ul className="rows">
          {outposts.map((outpost) => (
            <li
              key={outpost.id}
              className={outpost.id === openId ? 'proj op-row active' : 'proj op-row'}
            >
              <button
                type="button"
                className="proj-head"
                aria-label={
                  outpost.needsYou > 0
                    ? `${outpost.name}, ${needsYouLabel(outpost.needsYou)}`
                    : undefined
                }
                aria-current={outpost.id === openId ? 'page' : undefined}
                onClick={() => onOpen(outpost.id)}
              >
                <OutpostIcon />
                <span className="nm">{outpost.name}</span>
                {outpost.needsYou > 0 && (
                  <span className="op-needs" title={`Needs you: ${outpost.needsYou}`}>
                    {outpost.needsYou}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
