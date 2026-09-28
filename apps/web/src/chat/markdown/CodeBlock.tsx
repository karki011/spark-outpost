import { useEffect, useState } from 'react';
import { copyButtonText, useCopyFeedback } from '../../ui/use-copy-feedback.ts';
import { highlight, resolveLanguage } from './highlighter.ts';

interface CodeBlockProps {
  code: string;
  language: string | undefined;
  streaming: boolean;
}

export function CodeBlock({ code, language, streaming }: CodeBlockProps) {
  const resolved = resolveLanguage(language);
  const [html, setHtml] = useState<{ code: string; html: string } | null>(null);

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

  const { state: copyState, copy } = useCopyFeedback();

  return (
    <figure className="md-code">
      <figcaption>
        <span>{language || 'text'}</span>
        <button type="button" className="md-copy" onClick={() => copy(code)}>
          {copyButtonText(copyState)}
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
