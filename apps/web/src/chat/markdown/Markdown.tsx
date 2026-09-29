import { createContext, memo, use, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remend from 'remend';
import { CodeBlock } from './CodeBlock.tsx';
import { splitBlocks, withoutClarifyBlock } from './markdown-blocks.ts';
import './code-tokens.css';
import './markdown.css';

interface MarkdownProps {
  text: string;
  streaming?: boolean;
}

const LANGUAGE_CLASS = /language-([\w+-]+)/;
const SAFE_LINK = /^(https?:|mailto:)/i;

function plainText(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(plainText).join('');
  return '';
}

const StreamingContext = createContext(false);

function CodeElement({
  className,
  children,
}: {
  className?: string | undefined;
  children?: ReactNode;
}) {
  const streaming = use(StreamingContext);
  const text = plainText(children);
  const language = LANGUAGE_CLASS.exec(className ?? '')?.[1];
  if (!language && !text.includes('\n')) return <code>{children}</code>;
  return <CodeBlock code={text.replace(/\n$/, '')} language={language} streaming={streaming} />;
}

const components: Components = {
  pre: ({ children }) => <>{children}</>,
  code: CodeElement,
  a: ({ href, children }) =>
    href && SAFE_LINK.test(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span className="md-link-off">{children}</span>
    ),
  img: ({ alt, src }) => (
    <span className="md-image-off" title={typeof src === 'string' ? src : undefined}>
      Image not loaded{alt ? `: ${alt}` : ''}
    </span>
  ),
  table: ({ children }) => (
    <div className="md-table">
      <table>{children}</table>
    </div>
  ),
};

const remarkPlugins = [remarkGfm];

const MarkdownBlock = memo(function MarkdownBlock({ text, streaming }: Required<MarkdownProps>) {
  return (
    <StreamingContext value={streaming}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {streaming ? remend(text) : text}
      </ReactMarkdown>
    </StreamingContext>
  );
});

export const Markdown = memo(function Markdown({ text, streaming = false }: MarkdownProps) {
  const blocks = splitBlocks(withoutClarifyBlock(text));
  return (
    <div className="md">
      {blocks.map((block, index) => (
        <MarkdownBlock
          key={index}
          text={block}
          streaming={streaming && index === blocks.length - 1}
        />
      ))}
    </div>
  );
});
