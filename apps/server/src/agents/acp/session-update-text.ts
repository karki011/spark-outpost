import type { ContentBlock, ToolCallContent } from '@agentclientprotocol/sdk/unstable';
import type { ProviderOutput } from '../../providers/provider.ts';

type LinkSource = Extract<ProviderOutput, { kind: 'link' }>['source'];

const NOTICE_LABELS: Record<string, string> = { error: 'Error', warning: 'Warning' };

export const noticeLabel = (severity: string) => NOTICE_LABELS[severity] ?? 'Note';

const WEB_LINK = /^https?:$/;

export function messageText(content: ContentBlock): string {
  if (content.type === 'text') return content.text;
  if (content.type !== 'resource_link') return '';
  let url: URL;
  try {
    url = new URL(content.uri);
  } catch {
    return '';
  }
  if (!WEB_LINK.test(url.protocol)) return '';
  const label = content.name.replace(/[[\]]/g, '').trim() || url.hostname;
  return `[${label}](${url.href.replace(/[()]/g, (paren) => (paren === '(' ? '%28' : '%29'))})`;
}

export function toolTexts(
  content: readonly ToolCallContent[] | null | undefined,
  rawOutput: unknown,
): [string, LinkSource][] {
  const texts: [string, LinkSource][] = [];
  for (const item of content ?? []) {
    if (item.type !== 'content') continue;
    if (item.content.type === 'text') texts.push([item.content.text, 'tool_output']);
    if (item.content.type === 'resource_link') texts.push([item.content.uri, 'resource_link']);
  }
  if (rawOutput !== undefined && rawOutput !== null) {
    texts.push([
      typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput),
      'tool_output',
    ]);
  }
  return texts;
}
