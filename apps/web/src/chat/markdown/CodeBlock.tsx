import { useEffect, useState } from 'react';
import { highlight, resolveLanguage } from './highlighter.ts';

interface CodeBlockProps {
  code: string;
  language: string | undefined;
  streaming: boolean;
}

type CopyState = 'idle' | 'copied' | 'failed';

export function CodeBlock({ code, language, streaming }: CodeBlockProps) {
  const resolved = resolveLanguage(language);
  const [html, setHtml] = useState<{ code: string; html: string } | null>(null);
  const [copy, setCopy] = useState<CopyState>('idle');

  useEffect(() => {
    if (!resolved || streaming) return;
    let current = true;
    highlight(code, resolved)
      .then((result) => {
        if (current) setHtml({ code, html: result });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [code, resolved, streaming]);

  useEffect(() => {
    if (copy === 'idle') return;
    const timeout = setTimeout(() => setCopy('idle'), 1600);
    return () => clearTimeout(timeout);
  }, [copy]);

  const copyCode = () => {
    navigator.clipboard.writeText(code).then(
      () => setCopy('copied'),
      () => setCopy('failed'),
    );
  };

  return (
    <figure className="md-code">
      <figcaption>
        <span>{language || 'text'}</span>
        <button type="button" className="md-copy" onClick={copyCode}>
          {copy === 'copied' ? 'Copied' : copy === 'failed' ? 'Copy failed' : 'Copy'}
        </button>
      </figcaption>
      {html && html.code === code ? (
        <div className="md-pre" dangerouslySetInnerHTML={{ __html: html.html }} />
      ) : (
        <div className="md-pre">
          <pre>
            <code>{code}</code>
          </pre>
        </div>
      )}
    </figure>
  );
}
