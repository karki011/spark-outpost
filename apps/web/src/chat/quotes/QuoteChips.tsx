import './quotes.css';
import { useState } from 'react';
import { XIcon } from '../../ui/icons.tsx';
import { QuoteIcon } from './quote-icons.tsx';
import { quotePreview } from './quote-text.ts';
import type { Quote } from './use-quotes.ts';

interface QuoteChipsProps {
  items: readonly Quote[];
  onRemove: (id: string) => void;
}

const REMOVE_LABEL_LENGTH = 40;

export function QuoteChips({ items, onRemove }: QuoteChipsProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (items.length === 0) return null;
  return (
    <div className="quote-chips" role="group" aria-label="Quotes">
      {items.map((quote) => {
        const open = expanded === quote.id;
        return (
          <div key={quote.id} className={open ? 'chip quote-chip open' : 'chip quote-chip'}>
            <button
              type="button"
              className="qc-body"
              aria-expanded={open}
              onClick={() => setExpanded(open ? null : quote.id)}
            >
              <QuoteIcon />
              <span className="qc-main">
                <span className="qc-text">{open ? quote.text : quotePreview(quote.text)}</span>
                {quote.note && <small className="qc-note">{quote.note}</small>}
              </span>
            </button>
            <button
              type="button"
              className="chip-x"
              aria-label={`Remove quote: ${quotePreview(quote.text, REMOVE_LABEL_LENGTH)}`}
              onClick={() => onRemove(quote.id)}
            >
              <XIcon />
            </button>
          </div>
        );
      })}
    </div>
  );
}
