import type { ReactNode } from 'react';
import type { ExtraProps } from 'react-markdown';
import { Breakout } from '../breakout/Breakout.tsx';
import { CodeBlock } from './CodeBlock.tsx';

type HastNode = NonNullable<ExtraProps['node']>['children'][number];

function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element') {
    return node.tagName === 'br' ? '\n' : node.children.map(textOf).join('');
  }
  return '';
}

export function Preformatted({ node, children }: { children?: ReactNode } & ExtraProps) {
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
