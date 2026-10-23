import type { ReactNode } from 'react';
import { QuoteIcon, StrokeIcon } from '../../../ui/icons.tsx';
import type { LineFormat } from './md-block-format.ts';
import type { Mark } from './md-inline.ts';
import type { FormatAction } from './md-keys.ts';

export type ToolAction = FormatAction | LineFormat | 'codeblock';

export interface Tool {
  action: ToolAction;
  label: string;
  icon: ReactNode;
  mark?: Mark;
}

export const INLINE_TOOLS: readonly Tool[] = [
  {
    action: 'bold',
    label: 'Bold',
    mark: 'strong',
    icon: <StrokeIcon path="M7 5h6a3.5 3.5 0 0 1 0 7H7V5Zm0 7h7a3.5 3.5 0 0 1 0 7H7v-7Z" />,
  },
  {
    action: 'italic',
    label: 'Italic',
    mark: 'em',
    icon: <StrokeIcon path="M19 4h-9M14 20H5M15 4 9 20" />,
  },
  {
    action: 'strike',
    label: 'Strikethrough',
    mark: 'strike',
    icon: (
      <StrokeIcon path="M16.5 7c-.7-1.6-2.3-2.5-4.5-2.5-2.5 0-4.5 1.3-4.5 3.4 0 1.3.7 2.2 2 2.8M4 12h16M8.5 16.5c.7 1.8 2.4 3 5 3s4.5-1.3 4.5-3.4c0-.8-.2-1.5-.7-2.1" />
    ),
  },
  {
    action: 'code',
    label: 'Code',
    mark: 'code',
    icon: <StrokeIcon path="m8.5 7-5 5 5 5M15.5 7l5 5-5 5" />,
  },
  {
    action: 'link',
    label: 'Link',
    mark: 'link',
    icon: (
      <StrokeIcon path="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    ),
  },
];

export const BLOCK_TOOLS: readonly Tool[] = [
  {
    action: 'bullet',
    label: 'Bulleted list',
    icon: <StrokeIcon path="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  },
  {
    action: 'numbered',
    label: 'Numbered list',
    icon: (
      <StrokeIcon path="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M4 14.5a1.5 1.5 0 0 1 3 0c0 1.5-3 2-3 3.5h3" />
    ),
  },
  { action: 'quote', label: 'Quote', icon: <QuoteIcon /> },
  {
    action: 'codeblock',
    label: 'Code block',
    icon: <StrokeIcon path="M4 5h16v14H4V5Zm5 5-2 2 2 2m6-4 2 2-2 2" />,
  },
];
