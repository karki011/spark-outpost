import './info-tip.css';
import { createContext, use } from 'react';
import { guideLink } from '@spark-outpost/contracts';
import { BookIcon } from './icons.tsx';
import { useTooltip } from './Tooltip.tsx';

export interface DocTarget {
  page: string;
  heading?: string;
}

interface DocLinkProps {
  topic: string;
  doc: DocTarget;
}

export const DocsReachable = createContext(false);

export function DocLink({ topic, doc }: DocLinkProps) {
  const { triggerProps, tooltip } = useTooltip('Open in Docs', { side: 'top' });
  if (!use(DocsReachable)) return null;
  return (
    <>
      <a
        className="info-tip doc-link"
        href={guideLink(doc.page, doc.heading)}
        aria-label={`Read about ${topic} in Docs`}
        {...triggerProps}
      >
        <BookIcon />
      </a>
      {tooltip}
    </>
  );
}
