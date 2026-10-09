import { ExternalLinkIcon } from '../ui/icons.tsx';
import type { PrChipView } from './story-bar.ts';

export function PrChip({ pull }: { pull: PrChipView }) {
  const content = (
    <>
      <span aria-hidden="true">{pull.label}</span>
      {pull.mark !== 'open' && (
        <i className="op-pr-mark" aria-hidden="true">
          {pull.mark}
        </i>
      )}
      <span className="sr-only">{pull.name}</span>
    </>
  );
  if (!pull.url) return <span className={`op-pr ${pull.mark}`}>{content}</span>;
  return (
    <a className={`op-pr ${pull.mark}`} href={pull.url} target="_blank" rel="noreferrer">
      <ExternalLinkIcon />
      {content}
    </a>
  );
}
