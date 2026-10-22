import { useId, useState } from 'react';
import { Markdown } from '../chat/markdown/Markdown.tsx';
import { isLongMarkdown } from './answer-text.ts';
import { isLong } from './post-text.ts';

interface PostTextProps {
  text: string;
  what: string;
  markdown?: boolean;
  typed?: boolean;
}

export function PostText({ text, what, markdown = false, typed = false }: PostTextProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rendered = markdown || typed;
  const long = rendered ? isLongMarkdown(text) : isLong(text);
  const className = long && !open ? 'op-text clamped' : 'op-text';
  return (
    <>
      {rendered ? (
        <div id={id} className={`${className} op-md`}>
          <Markdown text={text} typed={typed} />
        </div>
      ) : (
        <p id={id} className={className}>
          {text}
        </p>
      )}
      {long && (
        <button
          type="button"
          className="op-link"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Show less' : `Show all of the ${what}`}
        </button>
      )}
    </>
  );
}
