import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import type { Project } from '@spark-outpost/contracts';
import { optionId } from './FileList.tsx';
import { caretLeft, findMention, removeMention, type Mention } from './mention.ts';
import { useFileSearch, type RepoFile } from './use-file-search.ts';

interface MentionOptions {
  repos: readonly Project[];
  draft: string;
  setDraft: (text: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onPick: (file: RepoFile) => void;
}

export function useMention({ repos, draft, setDraft, textareaRef, onPick }: MentionOptions) {
  const [mention, setMention] = useState<Mention | null>(null);
  const [left, setLeft] = useState(0);
  const dismissedAt = useRef<number | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const listId = useId();
  const open = repos.length > 0 && mention !== null;
  const search = useFileSearch(repos, mention?.query ?? '', open);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (pendingCaret.current === null || !textarea) return;
    textarea.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [draft, textareaRef]);

  const sync = (textarea: HTMLTextAreaElement) => {
    if (repos.length === 0) return;
    const found = findMention(textarea.value, textarea.selectionStart);
    if (!found || found.start === dismissedAt.current) {
      if (!found) dismissedAt.current = null;
      setMention(null);
      return;
    }
    setMention(found);
    setLeft(textarea.offsetLeft + caretLeft(textarea, found.start));
  };

  const pick = (file: RepoFile) => {
    if (!mention) return;
    pendingCaret.current = mention.start;
    setDraft(removeMention(draft, mention));
    setMention(null);
    onPick(file);
  };

  const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismissedAt.current = mention.start;
      setMention(null);
      return true;
    }
    return search.handleKey(event, pick);
  };

  return {
    open,
    listId,
    left,
    search,
    pick,
    sync,
    handleKey,
    dismiss: () => setMention(null),
    inputProps: open
      ? {
          'aria-controls': listId,
          'aria-activedescendant':
            search.files.length > 0 ? optionId(listId, search.active) : undefined,
        }
      : {},
  };
}
