import { useId, useState } from 'react';
import type { ModelCardView } from '@spark-outpost/contracts';
import { ChevronIcon } from '../ui/icons.tsx';
import { ModelBlob } from './ModelBlob.tsx';
import { ModelDetails } from './ModelDetails.tsx';
import { purposeLine, retirementTag, staleNote } from './model-list.ts';

export function ModelRow({ view }: { view: ModelCardView }) {
  const { card } = view;
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const nameId = `mc-${card.id.replace(/[^a-z0-9]+/gi, '-')}`;
  const purpose = purposeLine(view);
  const retirement = retirementTag(view);
  const stale = staleNote(view);
  return (
    <li className={open ? 'mc-row open' : 'mc-row'} aria-labelledby={nameId}>
      <h5 className="mc-row-head">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((value) => !value)}
        >
          <ModelBlob provider={card.provider} tier={card.tier} retiring={view.staleness.retiring} />
          <span className="mc-name" id={nameId}>
            {card.label}
          </span>
          {purpose && <span className="mc-purpose">{purpose}</span>}
          <span className="mc-tags">
            {view.isDefault && <span className="mc-tag default">default</span>}
            {!view.offered && <span className="mc-tag">not offered</span>}
            {retirement && <span className="mc-tag warn">{retirement}</span>}
            {stale && <span className="mc-tag warn">{stale.short}</span>}
          </span>
          <ChevronIcon />
        </button>
      </h5>
      <ModelDetails view={view} id={detailsId} open={open} />
    </li>
  );
}
