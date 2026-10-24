import { useEffect, useState, type RefObject } from 'react';
import { focusAtEnd } from './composer-hint.ts';
import {
  consumeComposerFocus,
  takeDraft,
  useComposerFocusRequest,
  usePendingDraft,
  type PendingDraft,
} from './pending-draft.ts';

function withTyped(typed: string, pending: PendingDraft): string {
  if (!pending.afterTyped || typed.trim() === '') return pending.text;
  return `${typed.trimEnd()}\n\n${pending.text}`;
}

export function useDraftRequests(
  conversationId: string,
  draft: string,
  setDraft: (text: string) => void,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  focusRequest: number,
): void {
  const pendingDraft = usePendingDraft(conversationId);
  const storeFocusRequest = useComposerFocusRequest(conversationId);
  const [appliedDraft, setAppliedDraft] = useState<PendingDraft | null>(null);
  if (pendingDraft !== appliedDraft) {
    setAppliedDraft(pendingDraft);
    if (pendingDraft !== null) setDraft(withTyped(draft, pendingDraft));
  }

  useEffect(() => {
    if (pendingDraft === null) return;
    takeDraft(conversationId);
    requestAnimationFrame(() => {
      const input = textareaRef.current;
      if (input) focusAtEnd(input);
    });
  }, [pendingDraft, conversationId, textareaRef]);

  useEffect(() => {
    if (focusRequest === 0 && storeFocusRequest === 0) return;
    const input = textareaRef.current;
    if (!input) return;
    focusAtEnd(input);
    if (storeFocusRequest !== 0) consumeComposerFocus(conversationId, storeFocusRequest);
  }, [conversationId, focusRequest, storeFocusRequest, textareaRef]);
}
