import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ATTACHMENTS_PER_MESSAGE,
  type Attachment,
  type AttachmentKind,
} from '@spark-outpost/contracts';
import type { ProjectFile } from '@spark-outpost/contracts';
import { attachmentUrl, classifyFile, uploadAttachment } from '../../api/attachments.ts';
import { ApiError } from '../../api/client.ts';
import { projectsApi } from '../../api/projects.ts';

export type AttachmentSource =
  { type: 'upload'; file: File } | { type: 'repo'; projectId: string; path: string };

export interface PendingAttachment {
  key: string;
  name: string;
  size: number;
  source: AttachmentSource;
  kind: AttachmentKind | null;
  mediaType: string | null;
  previewUrl: string | null;
  status: 'uploading' | 'done' | 'error';
  progress: number;
  error: string | null;
  retryable: boolean;
  attachment: Attachment | null;
}

export interface AttachmentsState {
  items: PendingAttachment[];
  notice: string | null;
  uploading: boolean;
  failed: boolean;
  uploaded: Attachment[];
  add: (files: File[]) => void;
  addFromRepo: (projectId: string, file: ProjectFile) => void;
  remove: (key: string) => void;
  retry: (key: string) => void;
  clear: () => void;
  notify: (message: string | null) => void;
}

function createItem(file: File): PendingAttachment {
  const classified = classifyFile(file);
  const base = {
    key: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    source: { type: 'upload', file } as const,
    progress: 0,
    attachment: null,
  };
  if ('error' in classified) {
    return {
      ...base,
      kind: null,
      mediaType: null,
      previewUrl: null,
      status: 'error',
      error: classified.error,
      retryable: false,
    };
  }
  return {
    ...base,
    kind: classified.kind,
    mediaType: classified.mediaType,
    previewUrl: classified.kind === 'image' ? URL.createObjectURL(file) : null,
    status: 'uploading',
    error: null,
    retryable: false,
  };
}

function createRepoItem(projectId: string, file: ProjectFile): PendingAttachment {
  return {
    key: crypto.randomUUID(),
    name: file.path.split('/').pop() ?? file.path,
    size: file.size,
    source: { type: 'repo', projectId, path: file.path },
    kind: null,
    mediaType: null,
    previewUrl: null,
    status: 'uploading',
    progress: 0,
    error: null,
    retryable: false,
    attachment: null,
  };
}

function transfer(
  item: PendingAttachment,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<Attachment> {
  if (item.source.type === 'repo') {
    return projectsApi.attach(item.source.projectId, item.source.path, signal);
  }
  return uploadAttachment(item.source.file, {
    mediaType: item.mediaType ?? 'text/plain',
    signal,
    onProgress,
  });
}

function completed(item: PendingAttachment, attachment: Attachment): Partial<PendingAttachment> {
  const changes = { status: 'done', progress: 1, attachment } as const;
  if (item.source.type === 'upload') return changes;
  return {
    ...changes,
    kind: attachment.kind,
    mediaType: attachment.mediaType,
    previewUrl: attachment.kind === 'image' ? attachmentUrl(attachment.id) : null,
  };
}

function isRetryable(error: unknown): boolean {
  return !(error instanceof ApiError) || (error.status !== 400 && error.status !== 413);
}

function revoke(item: PendingAttachment) {
  if (item.previewUrl && item.source.type === 'upload') URL.revokeObjectURL(item.previewUrl);
}

export function useAttachments(): AttachmentsState {
  const [items, setItems] = useState<PendingAttachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const itemsRef = useRef<PendingAttachment[]>([]);
  const controllers = useRef(new Map<string, AbortController>());

  const commit = useCallback((next: PendingAttachment[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const patch = useCallback(
    (key: string, changes: Partial<PendingAttachment>) => {
      commit(itemsRef.current.map((item) => (item.key === key ? { ...item, ...changes } : item)));
    },
    [commit],
  );

  const start = useCallback(
    (item: PendingAttachment) => {
      if (item.source.type === 'upload' && !item.mediaType) return;
      const controller = new AbortController();
      controllers.current.set(item.key, controller);
      transfer(item, controller.signal, (progress) => patch(item.key, { progress }))
        .then(
          (attachment) => patch(item.key, completed(item, attachment)),
          (error: unknown) => {
            if (controller.signal.aborted) return;
            patch(item.key, {
              status: 'error',
              error: error instanceof Error ? error.message : 'Upload failed.',
              retryable: isRetryable(error),
            });
          },
        )
        .finally(() => controllers.current.delete(item.key));
    },
    [patch],
  );

  const append = useCallback(
    (created: PendingAttachment[]) => {
      if (created.length === 0) return;
      const room = Math.max(0, ATTACHMENTS_PER_MESSAGE - itemsRef.current.length);
      setNotice(
        created.length > room
          ? `You can attach up to ${ATTACHMENTS_PER_MESSAGE} files per message.`
          : null,
      );
      const accepted = created.slice(0, room);
      commit([...itemsRef.current, ...accepted]);
      accepted.filter((item) => item.status === 'uploading').forEach(start);
    },
    [commit, start],
  );

  const add = useCallback((files: File[]) => append(files.map(createItem)), [append]);

  const addFromRepo = useCallback(
    (projectId: string, file: ProjectFile) => {
      const duplicate = itemsRef.current.some(
        (item) =>
          item.source.type === 'repo' &&
          item.source.projectId === projectId &&
          item.source.path === file.path &&
          item.status !== 'error',
      );
      if (!duplicate) append([createRepoItem(projectId, file)]);
    },
    [append],
  );

  const remove = useCallback(
    (key: string) => {
      controllers.current.get(key)?.abort();
      const item = itemsRef.current.find((candidate) => candidate.key === key);
      if (item) revoke(item);
      commit(itemsRef.current.filter((candidate) => candidate.key !== key));
      setNotice(null);
    },
    [commit],
  );

  const retry = useCallback(
    (key: string) => {
      const item = itemsRef.current.find((candidate) => candidate.key === key);
      if (!item?.retryable) return;
      const restarted = { ...item, status: 'uploading', progress: 0, error: null } as const;
      patch(key, restarted);
      start(restarted);
    },
    [patch, start],
  );

  const clear = useCallback(() => {
    controllers.current.forEach((controller) => controller.abort());
    itemsRef.current.forEach(revoke);
    commit([]);
    setNotice(null);
  }, [commit]);

  useEffect(() => {
    const active = controllers.current;
    return () => {
      active.forEach((controller) => controller.abort());
      itemsRef.current.forEach(revoke);
    };
  }, []);

  return {
    items,
    notice,
    uploading: items.some((item) => item.status === 'uploading'),
    failed: items.some((item) => item.status === 'error'),
    uploaded: items.flatMap((item) => (item.attachment ? [item.attachment] : [])),
    add,
    addFromRepo,
    remove,
    retry,
    clear,
    notify: setNotice,
  };
}
