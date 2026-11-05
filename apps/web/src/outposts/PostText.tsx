import { useId, useState } from 'react';
import { Markdown } from '../chat/markdown/Markdown.tsx';
import { isLongMarkdown } from './answer-text.ts';

interface PostTextProps {
  text: string;
  what: string;
}

export function PostText({ text, what }: PostTextProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const long = isLongMarkdown(text);
  const className = long && !open ? 'op-text clamped' : 'op-text';
  return (
    <>
      <div id={id} className={`${className} op-md`}>
        <Markdown text={text} typed />
      </div>
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
