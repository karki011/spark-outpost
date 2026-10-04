import { useEffect, useState, type RefObject } from 'react';
import { focusAtEnd } from './composer-hint.ts';
import { takeDraft, usePendingDraft } from './pending-draft.ts';

export function useDraftRequests(
  conversationId: string,
  setDraft: (text: string) => void,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  focusRequest: number,
): void {
  const pendingDraft = usePendingDraft(conversationId);
  const [appliedDraft, setAppliedDraft] = useState<string | null>(null);
  if (pendingDraft !== appliedDraft) {
    setAppliedDraft(pendingDraft);
    if (pendingDraft !== null) setDraft(pendingDraft);
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
    if (focusRequest === 0) return;
    const input = textareaRef.current;
    if (input) focusAtEnd(input);
  }, [focusRequest, textareaRef]);
}
