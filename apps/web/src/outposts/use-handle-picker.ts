import { useState, type KeyboardEvent } from 'react';
import { handleQuery, matchingHandles, withHandle, type Filled } from './composer-target.ts';
import type { MemberView } from './member-view.ts';

interface Typed {
  text: string;
  caret: number;
}

interface HandlePicking {
  options: MemberView[];
  current: number;
  setActive: (index: number) => void;
  reset: () => void;
  close: () => void;
  filled: (member: MemberView) => Filled | null;
  onKey: (event: KeyboardEvent<HTMLTextAreaElement>) => MemberView | 'handled' | null;
}

export function useHandlePicker(
  typed: Typed,
  members: readonly MemberView[],
  enabled: boolean,
): HandlePicking {
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const typing = enabled && !dismissed ? handleQuery(typed.text, typed.caret) : null;
  const options = matchingHandles(typing, members);
  const current = Math.min(active, options.length - 1);

  const onKey: HandlePicking['onKey'] = (event) => {
    if (options.length === 0) return null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + options.length) % options.length);
      return 'handled';
    }
    if (event.key === 'Enter' || event.key === 'Tab') return options[current] ?? 'handled';
    if (event.key === 'Escape') {
      setDismissed(true);
      return 'handled';
    }
    return null;
  };

  return {
    options,
    current,
    setActive,
    reset: () => {
      setActive(0);
      setDismissed(false);
    },
    close: () => setDismissed(true),
    filled: (member) =>
      typing ? withHandle(typed.text, typing, typed.caret, member.handle) : null,
    onKey,
  };
}
