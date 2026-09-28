import './quotes.css';
import { splitQuoted } from './quote-text.ts';

export function QuotedText({ text }: { text: string }) {
  const segments = splitQuoted(text);
  if (!segments.some((segment) => segment.kind === 'quote')) return <>{text}</>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'quote' ? (
          <blockquote key={index} className="msg-quote">
            {segment.text}
          </blockquote>
        ) : (
          <span
            key={index}
            className={segment.kind === 'lead' ? 'msg-quote-lead' : 'msg-quote-text'}
          >
            {segment.text}
          </span>
        ),
      )}
    </>
  );
}
