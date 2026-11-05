import { useId, useState } from 'react';
import type { ModelCardView } from '@spark-outpost/contracts';
import { ChevronIcon } from '../ui/icons.tsx';
import { ModelBlob } from './ModelBlob.tsx';
import { ModelDetails } from './ModelDetails.tsx';
import {
  benchmarkBadge,
  contextLine,
  effortRange,
  knowledgeMonth,
  MISSING,
  priceCells,
  purposeLine,
  retirementTag,
  staleNote,
} from './model-list.ts';

export const MODEL_COLUMNS = 10;

function Passed({ view }: { view: ModelCardView }) {
  const badge = benchmarkBadge(view);
  if (!badge) return <td className="num">{MISSING}</td>;
  return (
    <td className={badge.anecdotal ? 'num mc-anecdotal' : 'num'}>
      {badge.ratio}
      {badge.anecdotal && <span className="sr-only"> anecdotal</span>}
    </td>
  );
}

export function ModelRow({ view }: { view: ModelCardView }) {
  const { card } = view;
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const purpose = purposeLine(view);
  const retirement = retirementTag(view);
  const stale = staleNote(view);
  const [input, cached, output] = priceCells(card);
  return (
    <>
      <tr className={open ? 'mc-row open' : 'mc-row'}>
        <th scope="row" className="mc-model dt-pin">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((value) => !value)}
          >
            <ModelBlob
              provider={card.provider}
              tier={card.tier}
              retiring={view.staleness.retiring}
            />
            <span className="mc-label">
              <span className="mc-name">{card.label}</span>
              {purpose && <span className="mc-purpose">{purpose}</span>}
              <span className="mc-tags">
                {view.isDefault && <span className="mc-tag default">default</span>}
                {!view.offered && <span className="mc-tag">not offered</span>}
                {retirement && <span className="mc-tag warn">{retirement}</span>}
                {stale && <span className="mc-tag warn">{stale.short}</span>}
              </span>
            </span>
            <ChevronIcon />
          </button>
        </th>
        <td>{card.tier}</td>
        <td className="num">{input}</td>
        <td className="num">{cached}</td>
        <td className="num">{output}</td>
        <td className="num">{contextLine(card)}</td>
        <td>{card.speed}</td>
        <td>{effortRange(card)}</td>
        <td className="num">{knowledgeMonth(card)}</td>
        <Passed view={view} />
      </tr>
      <tr className="mc-detail-row" id={detailsId} hidden={!open}>
        <td colSpan={MODEL_COLUMNS}>
          <ModelDetails view={view} />
        </td>
      </tr>
    </>
  );
}

export function UncardedRow({ label }: { label: string }) {
  return (
    <tr className="mc-row">
      <th scope="row" className="mc-model dt-pin">
        <span className="mc-plain">
          <span className="mc-blob" aria-hidden="true" />
          <span className="mc-label">
            <span className="mc-name">{label}</span>
            <span className="mc-tags">
              <span className="mc-tag">No details yet</span>
            </span>
          </span>
        </span>
      </th>
      {Array.from({ length: MODEL_COLUMNS - 1 }, (_, index) => (
        <td key={index} className={index === 0 || index === 5 || index === 6 ? undefined : 'num'}>
          {MISSING}
        </td>
      ))}
    </tr>
  );
}
