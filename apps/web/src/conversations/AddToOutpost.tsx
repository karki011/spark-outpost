import './outpost-rows.css';
import { useId, useState, type KeyboardEvent } from 'react';
import {
  handleProblem,
  OUTPOST_MEMBERS_MAX,
  suggestHandle,
  type Outpost,
} from '@spark-outpost/contracts';
import { BackIcon, ChevronIcon, OutpostIcon, PlusIcon } from '../ui/icons.tsx';
import { MenuItem as Item } from './MenuShell.tsx';

export interface AddToOutpostActions {
  list: readonly Outpost[];
  onAdd: (outpostId: string, handle: string) => void;
  onNew: () => void;
}

const CARET_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];

export function memberCount(count: number): string {
  return count === 1 ? '1 chat' : `${count} chats`;
}

function typedHandle(text: string): string {
  return text.trim().replace(/^@/, '').toLowerCase();
}

export function AddToOutpostItem({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      data-submenu="outposts"
      onClick={onOpen}
    >
      <OutpostIcon />
      <span>Add to outpost</span>
      <span className="sub-chev">
        <ChevronIcon />
      </span>
    </button>
  );
}

interface OutpostPickProps {
  list: readonly Outpost[];
  onBack: () => void;
  onPick: (outpost: Outpost) => void;
  onNew: () => void;
}

export function OutpostPick({ list, onBack, onPick, onNew }: OutpostPickProps) {
  return (
    <>
      <button type="button" role="menuitem" className="back" onClick={onBack}>
        <BackIcon />
        <span>Add to outpost</span>
      </button>
      <hr />
      {list.length === 0 && <p className="lab">No outposts yet.</p>}
      {list.map((outpost) => (
        <Item
          key={outpost.id}
          icon={<OutpostIcon />}
          label={outpost.name}
          trailing={<small>{memberCount(outpost.members.length)}</small>}
          disabled={outpost.members.length >= OUTPOST_MEMBERS_MAX}
          onSelect={() => onPick(outpost)}
        />
      ))}
      <hr />
      <Item icon={<PlusIcon />} label="New outpost" onSelect={onNew} />
    </>
  );
}

interface HandlePickProps {
  outpost: Outpost;
  suggestFrom: string;
  onBack: () => void;
  onAdd: (handle: string) => void;
}

export function HandlePick({ outpost, suggestFrom, onBack, onAdd }: HandlePickProps) {
  const problemId = useId();
  const taken = outpost.members.map((member) => member.handle);
  const [handle, setHandle] = useState(() => suggestHandle(suggestFrom, taken));
  const problem = handleProblem(handle, taken);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (CARET_KEYS.includes(event.key)) event.stopPropagation();
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!problem) onAdd(handle);
  };
  return (
    <>
      <button type="button" role="menuitem" className="back" onClick={onBack}>
        <BackIcon />
        <span>Add to {outpost.name}</span>
      </button>
      <hr />
      <label className="ctx-handle-row">
        <span aria-hidden="true">Handle</span>
        <span className="ctx-handle-in">
          <span aria-hidden="true">@</span>
          <input
            data-menu-focus=""
            type="text"
            aria-label="Handle"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={handle}
            aria-invalid={problem !== null}
            aria-describedby={problem ? problemId : undefined}
            onChange={(event) => setHandle(typedHandle(event.target.value))}
            onKeyDown={onKeyDown}
          />
        </span>
      </label>
      {problem && (
        <p id={problemId} className="ctx-note ctx-problem" role="alert">
          {problem}
        </p>
      )}
      <Item
        icon={<PlusIcon />}
        label="Add to outpost"
        disabled={problem !== null}
        onSelect={() => onAdd(handle)}
      />
    </>
  );
}
