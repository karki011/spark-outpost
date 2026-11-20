import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { components, remarkPlugins } from './Markdown.tsx';
import { safeHtmlPlugins } from './safe-html.ts';
import './review-markdown.css';

const WEB_LINK = /^https?:\/\//i;

const reviewComponents: Components = {
  ...components,
  a: ({ href, children }) =>
    href && WEB_LINK.test(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span className="md-link-off">{children}</span>
    ),
};

export const ReviewMarkdown = memo(function ReviewMarkdown({ text }: { text: string }) {
  return (
    <div className="md md-review">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={safeHtmlPlugins}
        components={reviewComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
