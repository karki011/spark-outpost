import { useState } from 'react';
import {
  TICKET_START_FOLDERS_MAX,
  TICKET_START_LINKS_MAX,
  type StartTicketRequest,
} from '@spark-outpost/contracts';
import { useAttachments, type AttachmentsState } from '../chat/attachments/use-attachments.ts';
import { useSecretGuard, type SecretGuard } from '../ui/use-secret-guard.ts';

type ContextRequest = Pick<StartTicketRequest, 'note' | 'links' | 'attachmentIds' | 'folders'>;

export interface StartContextState {
  note: string;
  setNote: (note: string) => void;
  links: string[];
  addLink: (raw: string) => string | null;
  removeLink: (url: string) => void;
  folders: string[];
  addFolder: (path: string) => void;
  removeFolder: (path: string) => void;
  files: AttachmentsState;
  secrets: SecretGuard;
  count: number;
  hold: string | null;
  request: () => ContextRequest;
}

export function linkProblem(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:' || url.protocol === 'https:') return null;
  } catch {
    return 'Use a full web address, such as https://example.com/spec.';
  }
  return 'Only web links (http or https) can be added.';
}

export function useStartContext(): StartContextState {
  const [note, setNote] = useState('');
  const [links, setLinks] = useState<string[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const files = useAttachments();
  const secrets = useSecretGuard(note.trim());

  const addLink = (raw: string) => {
    const url = raw.trim();
    const problem = linkProblem(url);
    if (problem) return problem;
    if (links.length >= TICKET_START_LINKS_MAX) {
      return `You can add up to ${TICKET_START_LINKS_MAX} links.`;
    }
    if (!links.includes(url)) setLinks([...links, url]);
    return null;
  };

  const addFolder = (path: string) => {
    if (folders.includes(path) || folders.length >= TICKET_START_FOLDERS_MAX) return;
    setFolders([...folders, path]);
  };

  const hold = files.uploading
    ? 'Wait for the files to finish attaching.'
    : files.failed
      ? "Remove the files that couldn't be attached."
      : null;

  return {
    note,
    setNote,
    links,
    addLink,
    removeLink: (url) => setLinks(links.filter((link) => link !== url)),
    folders,
    addFolder,
    removeFolder: (path) => setFolders(folders.filter((folder) => folder !== path)),
    files,
    secrets,
    count: links.length + folders.length + files.items.length + (note.trim() ? 1 : 0),
    hold,
    request: () => ({
      note: note.trim(),
      links,
      attachmentIds: files.uploaded.map((attachment) => attachment.id),
      folders,
    }),
  };
}
