import {
  browserPageTextSchema,
  type BrowserPageText,
  type BrowserProfile,
  type InvolvementLevel,
} from '@spark-outpost/contracts';
import { uploadAttachment } from '../api/attachments.ts';
import { api, newDraftId } from '../api/client.ts';
import { evidence, pageLines } from '../browser/pick-files.ts';
import { desktopBrowserView } from '../desktop/desktop-bridge.ts';

export interface PageRef {
  profile: BrowserProfile;
  tabId: string;
  title: string;
  url: string;
}

export interface PageChatStart {
  page: PageRef | null;
  selection: string | null;
  text: string;
  projectId: string | null;
  level: InvolvementLevel;
}

const PAGE_HEADING = 'The user attached the text of this page from the Browser view.';
const SELECTION_HEADING = 'The user selected this text in the Browser view.';

export function pageTextNote(page: BrowserPageText): string {
  const scope = page.main ? 'Main region of the page.' : 'Whole page; it has no main region.';
  return [PAGE_HEADING, scope, ...pageLines(page), '', ...evidence([page.text])].join('\n');
}

export function selectionNote(page: Pick<PageRef, 'title' | 'url'>, text: string): string {
  return [SELECTION_HEADING, ...pageLines(page), '', ...evidence([text])].join('\n');
}

export async function readTabText(page: PageRef): Promise<BrowserPageText> {
  const view = desktopBrowserView();
  const raw = view ? await view.pageText(page.profile, page.tabId).catch(() => null) : null;
  const read = browserPageTextSchema.safeParse(raw);
  if (!read.success) throw new Error(`“${page.title}” is closed or blank, so its text can’t go.`);
  return read.data;
}

async function capturePage(page: PageRef): Promise<File> {
  const read = await readTabText(page);
  return new File([pageTextNote(read)], 'page-text.txt', { type: 'text/plain' });
}

export async function startPageChat(start: PageChatStart): Promise<string> {
  const files: File[] = [];
  if (start.page) files.push(await capturePage(start.page));
  if (start.selection && start.page) {
    const note = selectionNote(start.page, start.selection);
    files.push(new File([note], 'selected-text.txt', { type: 'text/plain' }));
  }
  const uploaded = await Promise.all(
    files.map((file) => uploadAttachment(file, { mediaType: 'text/plain' })),
  );
  const chatId = newDraftId();
  await api.updateChatSettings(chatId, {
    level: start.level,
    ...(start.projectId ? { projectIds: [start.projectId] } : {}),
  });
  await api.sendMessage(
    chatId,
    crypto.randomUUID(),
    start.text,
    uploaded.map((attachment) => attachment.id),
  );
  return chatId;
}
