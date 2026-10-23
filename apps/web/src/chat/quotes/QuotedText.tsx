import './quotes.css';
import { Markdown } from '../markdown/Markdown.tsx';
import { splitQuoted } from './quote-text.ts';

export function QuotedText({ text }: { text: string }) {
  const segments = splitQuoted(text);
  if (segments[0]?.kind !== 'lead') return <Markdown text={text} typed />;
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'quote' ? (
          <blockquote key={index} className="msg-quote">
            {segment.text}
          </blockquote>
        ) : segment.kind === 'lead' ? (
          <span key={index} className="msg-quote-lead">
            {segment.text}
          </span>
        ) : (
          <div key={index} className="msg-quote-text">
            <Markdown text={segment.text} typed />
          </div>
        ),
      )}
    </>
  );
}
