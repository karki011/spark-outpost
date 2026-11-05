import {
  ARTIFACT_KIND_LABELS,
  type ArtifactPage,
  type ChatFile,
  type ConversationDetail,
} from '@spark-outpost/contracts';
import { formatBytes } from '../api/attachments.ts';

export interface LibraryChat {
  conversationId: string;
  handle: string;
  detail: Pick<ConversationDetail, 'chatFiles' | 'artifactPages'> | undefined;
}

export interface LibraryEntry {
  id: string;
  name: string;
  meta: string;
  conversationId: string;
  handle: string;
}

export interface OutpostLibrary {
  artifacts: LibraryEntry[];
  files: LibraryEntry[];
}

function artifactMeta(page: ArtifactPage): string {
  const versions = page.versions.length;
  const kind = ARTIFACT_KIND_LABELS[page.kind];
  return versions > 1 ? `${kind} · version ${versions}` : kind;
}

function fileOf(file: ChatFile, chat: LibraryChat): LibraryEntry {
  return {
    id: file.id,
    name: file.name,
    meta: formatBytes(file.size),
    conversationId: chat.conversationId,
    handle: chat.handle,
  };
}

export function outpostLibrary(chats: readonly LibraryChat[]): OutpostLibrary {
  return {
    artifacts: chats.flatMap((chat) =>
      (chat.detail?.artifactPages ?? []).map((page) => ({
        id: page.id,
        name: page.title,
        meta: artifactMeta(page),
        conversationId: chat.conversationId,
        handle: chat.handle,
      })),
    ),
    files: chats.flatMap((chat) =>
      (chat.detail?.chatFiles ?? []).map((file) => fileOf(file, chat)),
    ),
  };
}
