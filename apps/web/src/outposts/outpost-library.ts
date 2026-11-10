import {
  ARTIFACT_KIND_LABELS,
  type LibraryArtifact,
  type LibraryFile,
  type OutpostLibraryChats,
} from '@spark-outpost/contracts';
import { formatBytes } from '../api/attachments.ts';

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

export interface LibraryMember {
  conversationId: string;
  handle: string;
}

function artifactMeta(artifact: LibraryArtifact): string {
  const kind = ARTIFACT_KIND_LABELS[artifact.kind];
  return artifact.versions > 1 ? `${kind} · version ${artifact.versions}` : kind;
}

function fileEntry(file: LibraryFile, member: LibraryMember): LibraryEntry {
  return {
    id: file.id,
    name: file.name,
    meta: formatBytes(file.size),
    conversationId: member.conversationId,
    handle: member.handle,
  };
}

export function outpostLibrary(
  members: readonly LibraryMember[],
  library: OutpostLibraryChats | undefined,
): OutpostLibrary {
  const byChat = new Map((library?.chats ?? []).map((chat) => [chat.conversationId, chat]));
  return {
    artifacts: members.flatMap((member) =>
      (byChat.get(member.conversationId)?.artifacts ?? []).map((artifact) => ({
        id: artifact.id,
        name: artifact.title,
        meta: artifactMeta(artifact),
        conversationId: member.conversationId,
        handle: member.handle,
      })),
    ),
    files: members.flatMap((member) =>
      (byChat.get(member.conversationId)?.files ?? []).map((file) => fileEntry(file, member)),
    ),
  };
}
