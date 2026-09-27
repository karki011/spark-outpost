import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import type { AgentCommand } from '@spark-outpost/contracts';
import {
  filterSlashItems,
  findSlashQuery,
  slashItems,
  type ClientCommandName,
  type SlashContext,
  type SlashItem,
  type SlashQuery,
} from './slash.ts';

interface SlashOptions {
  draft: string;
  setDraft: (text: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  agentCommands: readonly AgentCommand[];
  context: SlashContext;
  onRun: (command: ClientCommandName) => void;
}

export function slashOptionId(listId: string, index: number): string {
  return `${listId}-${index}`;
}

export function useSlash({
  draft,
  setDraft,
  textareaRef,
  agentCommands,
  context,
  onRun,
}: SlashOptions) {
  const [query, setQuery] = useState<SlashQuery | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [selection, setSelection] = useState({ query: '', index: 0 });
  const pendingCaret = useRef<number | null>(null);
  const listId = useId();
  const all = useMemo(() => slashItems(agentCommands, context), [agentCommands, context]);
  const items = useMemo(() => filterSlashItems(all, query?.query ?? ''), [all, query]);
  const open = query !== null && !dismissed;
  const index = selection.query === (query?.query ?? '') ? selection.index : 0;
  const active = Math.min(index, Math.max(0, items.length - 1));
  const setActive = (next: number) => setSelection({ query: query?.query ?? '', index: next });

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (pendingCaret.current === null || !textarea) return;
    textarea.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [draft, textareaRef]);

  const sync = (textarea: HTMLTextAreaElement) => {
    const found = findSlashQuery(textarea.value, textarea.selectionStart);
    if (!textarea.value.startsWith('/')) setDismissed(false);
    setQuery(found);
  };

  const pick = (item: SlashItem) => {
    setQuery(null);
    if (item.source === 'client' && item.hint === null) {
      setDraft('');
      onRun(item.name as ClientCommandName);
      return;
    }
    const text = `/${item.name} `;
    pendingCaret.current = text.length;
    setDraft(text);
  };

  const handleKey = (event: KeyboardEvent<HTMLElement>): boolean => {
    if (!open) return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
      return true;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length === 0) return true;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((active + step + items.length) % items.length);
      return true;
    }
    const item = items[active];
    const choosing = event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey);
    if (choosing && item && !event.nativeEvent.isComposing) {
      event.preventDefault();
      pick(item);
      return true;
    }
    return false;
  };

  return {
    open,
    listId,
    all,
    items,
    active,
    setActive,
    pick,
    sync,
    handleKey,
    dismiss: () => setQuery(null),
    inputProps: open
      ? {
          'aria-controls': listId,
          'aria-activedescendant': items.length > 0 ? slashOptionId(listId, active) : undefined,
        }
      : {},
  };
}
