import { createContext, isValidElement, memo, use, type ReactNode } from 'react';
import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remend from 'remend';
import { Breakout } from '../breakout/Breakout.tsx';
import { CodeBlock } from './CodeBlock.tsx';
import { InsidePre, Preformatted } from './Preformatted.tsx';
import { safeHtmlPlugins } from './safe-html.ts';
import { splitBlocks, withoutClarifyBlock } from './markdown-blocks.ts';
import './code-tokens.css';
import './markdown.css';

interface MarkdownProps {
  text: string;
  streaming?: boolean;
  typed?: boolean;
  html?: boolean;
}

const LANGUAGE_CLASS = /language-([\w+-]+)/;
const SAFE_LINK = /^(https?:|mailto:)/i;

function plainText(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(plainText).join('');
  if (isValidElement<{ children?: ReactNode }>(children)) return plainText(children.props.children);
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
  const insidePre = use(InsidePre);
  const text = plainText(children);
  const language = LANGUAGE_CLASS.exec(className ?? '')?.[1];
  if (!language && !insidePre && !text.includes('\n')) return <code>{children}</code>;
  return (
    <Breakout>
      <CodeBlock code={text.replace(/\n$/, '')} language={language} streaming={streaming} />
    </Breakout>
  );
}

export const codeComponents: Components = {
  pre: ({ children }) => <>{children}</>,
  code: CodeElement,
  table: ({ children }) => (
    <Breakout>
      <div className="md-table">
        <table>{children}</table>
      </div>
    </Breakout>
  ),
};

export const components: Components = {
  ...codeComponents,
  pre: Preformatted,
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
};

export const remarkPlugins = [remarkGfm];

const LITERAL_HTML: Options['rehypePlugins'] = [];

const MarkdownBlock = memo(function MarkdownBlock({
  text,
  streaming,
  html,
}: Required<Omit<MarkdownProps, 'typed'>>) {
  return (
    <StreamingContext value={streaming}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={html ? safeHtmlPlugins : LITERAL_HTML}
        components={components}
      >
        {streaming ? remend(text) : text}
      </ReactMarkdown>
    </StreamingContext>
  );
});

export const Markdown = memo(function Markdown({
  text,
  streaming = false,
  typed = false,
  html = !typed,
}: MarkdownProps) {
  const blocks = splitBlocks(typed ? text : withoutClarifyBlock(text));
  return (
    <div className={typed ? 'md md-typed' : 'md'}>
      {blocks.map((block, index) => (
        <MarkdownBlock
          key={index}
          text={block}
          streaming={streaming && index === blocks.length - 1}
          html={html}
        />
      ))}
    </div>
  );
});
