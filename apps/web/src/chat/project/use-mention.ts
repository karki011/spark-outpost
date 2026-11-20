import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import {
  sparkMentionText,
  type Project,
  type TeammateView,
  type WorkflowSummary,
} from '@spark-outpost/contracts';
import { workflowsMatching } from '../../crew-flows/workflow-mentions.ts';
import { sparksMatching } from '../../teammates/use-mention-sparks.ts';
import { optionId } from './FileList.tsx';
import { caretLeft, findMention, removeMention, type Mention } from './mention.ts';
import { useFileSearch, type FileSearch, type RepoFile } from './use-file-search.ts';

interface MentionOptions {
  repos: readonly Project[];
  sparks: readonly TeammateView[];
  workflows: readonly WorkflowSummary[];
  draft: string;
  setDraft: (text: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onPick: (file: RepoFile) => void;
}

export function sparkOptionId(listId: string, index: number): string {
  return `${listId}-spark-${index}`;
}

export function workflowOptionId(listId: string, index: number): string {
  return `${listId}-workflow-${index}`;
}

export function useMention({
  repos,
  sparks,
  workflows,
  draft,
  setDraft,
  textareaRef,
  onPick,
}: MentionOptions) {
  const [mention, setMention] = useState<Mention | null>(null);
  const [left, setLeft] = useState(0);
  const [picked, setPicked] = useState({ query: '', index: 0 });
  const dismissedAt = useRef<number | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const listId = useId();
  const query = mention?.query ?? '';
  const matches = mention ? sparksMatching(sparks, query) : [];
  const flows = mention ? workflowsMatching(workflows, query, sparks) : [];
  const named = matches.length + flows.length;
  const hasRepos = repos.length > 0;
  const open = mention !== null && (hasRepos || named > 0);
  const search = useFileSearch(repos, query, open && hasRepos);
  const files = hasRepos ? search.files : [];
  const total = named + files.length;
  const wanted = picked.query === query ? picked.index : 0;
  const active = Math.min(wanted, Math.max(0, total - 1));
  const setActive = (index: number) => setPicked({ query, index });

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (pendingCaret.current === null || !textarea) return;
    textarea.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [draft, textareaRef]);

  const sync = (textarea: HTMLTextAreaElement) => {
    if (!hasRepos && sparks.length === 0 && workflows.length === 0) return;
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

  const insertName = (name: string) => {
    if (!mention) return;
    const text = `${sparkMentionText(name)} `;
    pendingCaret.current = mention.start + text.length;
    setDraft(draft.slice(0, mention.start) + text + draft.slice(mention.end).trimStart());
    setMention(null);
  };
  const pickSpark = (spark: TeammateView) => insertName(spark.name);
  const pickWorkflow = (workflow: WorkflowSummary) => insertName(workflow.id);

  const pickActive = (): boolean => {
    const spark = matches[active];
    const flow = flows[active - matches.length];
    const file = files[active - named];
    if (spark) pickSpark(spark);
    else if (flow) pickWorkflow(flow);
    else if (file) pick(file);
    return Boolean(spark ?? flow ?? file);
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
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (total > 0) setActive((active + (event.key === 'ArrowDown' ? 1 : -1) + total) % total);
      return true;
    }
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || total === 0) return false;
    event.preventDefault();
    return pickActive();
  };

  const fileSearch: FileSearch = {
    ...search,
    files,
    active: active - named,
    setActive: (index) => setActive(index + named),
  };
  const activeId =
    active < matches.length
      ? sparkOptionId(listId, active)
      : active < named
        ? workflowOptionId(listId, active - matches.length)
        : optionId(listId, fileSearch.active);

  return {
    open,
    listId,
    left,
    sparks: matches,
    workflows: flows,
    active,
    setActive,
    showsFiles: hasRepos,
    search: fileSearch,
    pick,
    pickSpark,
    pickWorkflow,
    sync,
    handleKey,
    dismiss: () => setMention(null),
    inputProps: open
      ? { 'aria-controls': listId, 'aria-activedescendant': total > 0 ? activeId : undefined }
      : {},
  };
}
