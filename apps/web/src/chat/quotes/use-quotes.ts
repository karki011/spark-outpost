import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ANNOTATION_QUOTE_MAX_LENGTH,
  ANNOTATIONS_PER_MESSAGE,
  type AnnotationInput,
  type AnnotationKind,
  type TextAnchor,
} from '@spark-outpost/contracts';
import { composeMessage, leadIn } from './quote-text.ts';
import { loadQuotes, saveQuotes } from './quote-storage.ts';

export interface Quote {
  id: string;
  kind: AnnotationKind;
  text: string;
  note: string;
  messageId: string | null;
  anchor: TextAnchor | null;
}

type NewQuote = Omit<Quote, 'id'>;

interface ComposedMessage {
  content: string;
  annotations: AnnotationInput[];
}

export interface QuotesState {
  items: readonly Quote[];
  focusRequest: number;
  add: (quote: NewQuote) => void;
  remove: (id: string) => void;
  clear: () => void;
  requestFocus: () => void;
  compose: (typed: string) => ComposedMessage;
}

function toAnnotation(quote: Quote): AnnotationInput[] {
  if (!quote.messageId || !quote.anchor) return [];
  if (quote.text.length > ANNOTATION_QUOTE_MAX_LENGTH) return [];
  if (quote.anchor.exact.length > ANNOTATION_QUOTE_MAX_LENGTH) return [];
  return [
    {
      id: quote.id,
      sourceMessageId: quote.messageId,
      kind: quote.kind,
      quote: quote.text,
      note: quote.note,
      anchor: quote.anchor,
    },
  ];
}

export function useQuotes(conversationId: string, latestReplyId: string | null): QuotesState {
  const [items, setItems] = useState<readonly Quote[]>(() => loadQuotes(conversationId));
  const [focusRequest, setFocusRequest] = useState(0);

  useEffect(() => {
    saveQuotes(conversationId, items);
  }, [conversationId, items]);

  const add = useCallback((quote: NewQuote) => {
    setItems((current) => {
      const duplicate = current.some(
        (existing) =>
          existing.text === quote.text &&
          existing.note === quote.note &&
          existing.messageId === quote.messageId,
      );
      return duplicate ? current : [...current, { ...quote, id: crypto.randomUUID() }];
    });
  }, []);
  const remove = useCallback(
    (id: string) => setItems((current) => current.filter((quote) => quote.id !== id)),
    [],
  );
  const clear = useCallback(() => setItems([]), []);
  const requestFocus = useCallback(() => setFocusRequest((count) => count + 1), []);
  const compose = useCallback(
    (typed: string): ComposedMessage => {
      const lead = leadIn(
        items.map((quote) => quote.messageId),
        latestReplyId,
      );
      return {
        content: composeMessage(items, typed, lead),
        annotations: items.flatMap(toAnnotation).slice(0, ANNOTATIONS_PER_MESSAGE),
      };
    },
    [items, latestReplyId],
  );

  return useMemo(
    () => ({ items, focusRequest, add, remove, clear, requestFocus, compose }),
    [items, focusRequest, add, remove, clear, requestFocus, compose],
  );
}
