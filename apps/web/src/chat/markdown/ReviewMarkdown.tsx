import { memo, type ReactNode } from 'react';
import ReactMarkdown, { type Components, type ExtraProps, type Options } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { Breakout } from '../breakout/Breakout.tsx';
import { CodeBlock } from './CodeBlock.tsx';
import { components, remarkPlugins } from './Markdown.tsx';
import { reviewSchema } from './review-schema.ts';
import './review-markdown.css';

type HastNode = NonNullable<ExtraProps['node']>['children'][number];

const WEB_LINK = /^https?:\/\//i;

function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element') {
    return node.tagName === 'br' ? '\n' : node.children.map(textOf).join('');
  }
  return '';
}

function Preformatted({ node, children }: { children?: ReactNode } & ExtraProps) {
  const parts = node?.children ?? [];
  const wrapsCode = parts.some((part) => part.type === 'element' && part.tagName === 'code');
  if (wrapsCode) return <>{children}</>;
  return (
    <Breakout>
      <CodeBlock
        code={parts.map(textOf).join('').replace(/\n$/, '')}
        language={undefined}
        streaming={false}
      />
    </Breakout>
  );
}

const reviewComponents: Components = {
  ...components,
  pre: Preformatted,
  a: ({ href, children }) =>
    href && WEB_LINK.test(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span className="md-link-off">{children}</span>
    ),
};

const rehypePlugins: Options['rehypePlugins'] = [rehypeRaw, [rehypeSanitize, reviewSchema]];

export const ReviewMarkdown = memo(function ReviewMarkdown({ text }: { text: string }) {
  return (
    <div className="md md-review">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={reviewComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
