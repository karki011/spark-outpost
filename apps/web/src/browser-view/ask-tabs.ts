import type { BrowserPageText, BrowserPaneTab, BrowserProfile } from '@spark-outpost/contracts';
import { uploadAttachment } from '../api/attachments.ts';
import { queueApi } from '../chat/queue/queue-api.ts';
import { evidence, pageLines } from '../browser/pick-files.ts';
import { readTabText, type PageRef } from './page-chat.ts';
import { pageRef } from './page-intents.ts';

export const MENTIONS_MAX = 5;
const MENTION_LABEL_MAX = 30;
const LIST_MAX = 8;

export interface MentionToken {
  start: number;
  query: string;
}

export function profileName(profile: BrowserProfile): string {
  return profile === 'personal' ? 'Personal' : 'Work';
}

export function mentionLabel(page: Pick<PageRef, 'title'>): string {
  const title = page.title.trim().replace(/\s+/g, ' ');
  return title.length > MENTION_LABEL_MAX ? `${title.slice(0, MENTION_LABEL_MAX - 1)}…` : title;
}

export function mentionToken(text: string, caret: number): MentionToken | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1] ?? '')) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { start: at, query };
}

export function insertMention(
  text: string,
  token: MentionToken,
  caret: number,
  page: Pick<PageRef, 'title'>,
): { text: string; caret: number } {
  const rest = text.slice(caret);
  const spaced = /^\s/.test(rest);
  const mention = `@${mentionLabel(page)}${spaced ? '' : ' '}`;
  const after = token.start + mention.length + (spaced ? 1 : 0);
  return { text: text.slice(0, token.start) + mention + rest, caret: after };
}

export function mentionChoices(
  open: ReadonlyMap<BrowserProfile, readonly BrowserPaneTab[]>,
  query: string,
  chosen: readonly PageRef[],
): PageRef[] {
  const wanted = query.toLowerCase();
  const taken = new Set(chosen.map((page) => `${page.profile}:${page.tabId}`));
  const pages = [...open].flatMap(([profile, tabs]) =>
    tabs.filter((tab) => tab.url !== '' && tab.error === null).map((tab) => pageRef(profile, tab)),
  );
  return pages
    .filter((page) => !taken.has(`${page.profile}:${page.tabId}`))
    .filter(
      (page) =>
        page.title.toLowerCase().includes(wanted) || page.url.toLowerCase().includes(wanted),
    )
    .slice(0, LIST_MAX);
}

export function tabNote(page: PageRef, read: BrowserPageText): string {
  const scope = read.main ? 'Main region of the page.' : 'Whole page; it has no main region.';
  return [
    `The user @-mentioned this ${profileName(page.profile)} tab in their question.`,
    'You can’t open, reread or act in it; this text is all you get.',
    scope,
    ...pageLines(read),
    '',
    ...evidence([read.text]),
  ].join('\n');
}

export async function askAboutTabs(
  assistantId: string,
  id: string,
  question: string,
  mentions: readonly PageRef[],
): Promise<void> {
  const reads = await Promise.all(mentions.map(readTabText));
  const files = reads.map(
    (read, index) =>
      new File([tabNote(mentions[index]!, read)], `tab-${index + 1}.txt`, { type: 'text/plain' }),
  );
  const uploaded = await Promise.all(
    files.map((file) => uploadAttachment(file, { mediaType: 'text/plain' })),
  );
  await queueApi.add(
    assistantId,
    id,
    question,
    mentions.length > 0 ? 'pages' : undefined,
    uploaded.map((attachment) => attachment.id),
  );
}
