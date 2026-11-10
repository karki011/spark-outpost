import { useId, useState } from 'react';
import type { OutpostPost } from '@spark-outpost/contracts';
import { PinIcon } from '../ui/icons.tsx';

interface PinnedBarProps {
  notes: readonly OutpostPost[];
  onJump: (postId: string) => void;
}

const EXCERPT_MAX = 90;

function excerpt(body: string): string {
  const line = body.split('\n').find((each) => each.trim() !== '') ?? '';
  const text = line.replace(/\s+/g, ' ').trim();
  return text.length <= EXCERPT_MAX ? text : `${text.slice(0, EXCERPT_MAX - 1).trimEnd()}…`;
}

export function PinnedBar({ notes, onJump }: PinnedBarProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (notes.length === 0) return null;
  return (
    <div className="op-pinned">
      <button
        type="button"
        className="op-pinned-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((was) => !was)}
      >
        <PinIcon />
        Pinned · {notes.length}
      </button>
      {open && (
        <ul id={listId} aria-label="Pinned notes">
          {notes.map((note) => (
            <li key={note.id}>
              <button type="button" className="op-pinned-jump" onClick={() => onJump(note.id)}>
                {excerpt(note.body)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
