import { useId, useState } from 'react';
import { isLong } from './post-text.ts';

interface PostTextProps {
  text: string;
  what: string;
}

export function PostText({ text, what }: PostTextProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const long = isLong(text);
  return (
    <>
      <p id={id} className={long && !open ? 'op-text clamped' : 'op-text'}>
        {text}
      </p>
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
