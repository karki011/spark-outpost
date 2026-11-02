import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
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
  setDraft: Dispatch<SetStateAction<string>>,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  focusRequest: number,
): void {
  const pendingDraft = usePendingDraft(conversationId);
  const storeFocusRequest = useComposerFocusRequest(conversationId);
  useEffect(() => {
    if (pendingDraft === null) return;
    const pending = takeDraft(conversationId);
    if (!pending) return;
    setDraft((current) => withTyped(current, pending));
    requestAnimationFrame(() => {
      const input = textareaRef.current;
      if (input) focusAtEnd(input);
    });
  }, [pendingDraft, conversationId, textareaRef, setDraft]);

  useEffect(() => {
    if (focusRequest === 0 && storeFocusRequest === 0) return;
    const input = textareaRef.current;
    if (!input) return;
    focusAtEnd(input);
    if (storeFocusRequest !== 0) consumeComposerFocus(conversationId, storeFocusRequest);
  }, [conversationId, focusRequest, storeFocusRequest, textareaRef]);
}
