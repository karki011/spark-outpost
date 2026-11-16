import { useId, useState } from 'react';
import { Markdown } from '../markdown/Markdown.tsx';
import { Segmented } from '../../ui/Segmented.tsx';
import { WarnIcon } from '../../ui/icons.tsx';

const HIDDEN_MARKUP = /<!--|<\/?[a-z][\w-]*[\s/>]/i;

type View = 'formatted' | 'source';

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n?/;

function hasHiddenMarkup(text: string): boolean {
  return HIDDEN_MARKUP.test(text);
}

function formattedText(text: string): string {
  const front = FRONT_MATTER.exec(text);
  if (!front) return text;
  return `\`\`\`yaml\n${front[1]}\n\`\`\`\n\n${text.slice(front[0].length)}`;
}

interface MarkdownReviewProps {
  label: string;
  text: string;
}

export function MarkdownReview({ label, text }: MarkdownReviewProps) {
  const hidden = hasHiddenMarkup(text);
  const [view, setView] = useState<View>(hidden ? 'source' : 'formatted');
  const noteId = useId();
  return (
    <section className="mdr" aria-label={label}>
      <div className="mdr-bar">
        <b>{label}</b>
        <Segmented
          ariaLabel={`Show ${label.toLowerCase()} as`}
          {...(hidden ? { describedBy: noteId } : {})}
          options={[
            { id: 'formatted', label: 'Formatted' },
            { id: 'source', label: 'Source' },
          ]}
          value={view}
          onChange={(id) => setView(id as View)}
        />
      </div>
      {hidden && (
        <p className="mdr-note" id={noteId} role="note">
          <WarnIcon /> Has HTML or comments that only Source shows. Read the source before you allow
          it.
        </p>
      )}
      {view === 'formatted' ? (
        <div className="mdr-body">
          <Markdown text={formattedText(text)} typed />
        </div>
      ) : (
        <pre className="mdr-body mdr-source">{text}</pre>
      )}
    </section>
  );
}
