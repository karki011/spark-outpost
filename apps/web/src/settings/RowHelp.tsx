import { use, useId, useState } from 'react';
import { guideLink } from '@spark-outpost/contracts';
import { DocsReachable, type DocTarget } from '../ui/DocLink.tsx';
import { InfoIcon } from '../ui/icons.tsx';
import { TipBody, type TipContent } from '../ui/Tooltip.tsx';

interface RowHelpProps {
  topic: string;
  text: TipContent | undefined;
  doc: DocTarget;
}

export function useRowHelp({ topic, text, doc }: RowHelpProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const docs = use(DocsReachable);
  const empty = !docs && text === undefined;
  const button = empty ? null : (
    <button
      type="button"
      className="info-tip row-help-btn"
      aria-label={`More about ${topic}`}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={() => setOpen((current) => !current)}
    >
      <InfoIcon />
    </button>
  );
  const panel = (
    <div id={panelId} className="row-help" hidden={!open}>
      {typeof text === 'string' ? <p>{text}</p> : text && <TipBody content={text} />}
      {docs && (
        <a className="row-help-doc" href={guideLink(doc.page, doc.heading)}>
          <span aria-hidden="true">Open in Docs</span>
          <span className="sr-only">Read about {topic} in Docs</span>
        </a>
      )}
    </div>
  );
  return { button, panel };
}
