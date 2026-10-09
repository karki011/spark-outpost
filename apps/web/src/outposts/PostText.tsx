import { useId, useState } from 'react';
import { Markdown } from '../chat/markdown/Markdown.tsx';
import { isLongMarkdown } from './answer-text.ts';
import { isLong } from './post-text.ts';

interface PostTextProps {
  text: string;
  what: string;
  markdown?: boolean;
}

export function PostText({ text, what, markdown = false }: PostTextProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const long = markdown ? isLongMarkdown(text) : isLong(text);
  const className = long && !open ? 'op-text clamped' : 'op-text';
  return (
    <>
      {markdown ? (
        <div id={id} className={`${className} op-md`}>
          <Markdown text={text} />
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
