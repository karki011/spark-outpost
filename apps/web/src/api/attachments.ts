import {
  ATTACHMENT_IMAGE_MAX_BYTES,
  ATTACHMENT_IMAGE_TYPES,
  ATTACHMENT_NAME_MAX_LENGTH,
  ATTACHMENT_TEXT_MAX_BYTES,
  attachmentContentPath,
  attachmentSchema,
  type Attachment,
  type AttachmentKind,
} from '@spark-outpost/contracts';
import { ApiError } from './client.ts';

const TEXT_MEDIA_TYPES = new Set([
  'application/json',
  'application/javascript',
  'application/typescript',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
  'application/toml',
  'application/x-sh',
  'application/sql',
]);

export const TEXT_EXTENSIONS = [
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.csv',
  '.tsv',
  '.xml',
  '.html',
  '.css',
  '.scss',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.php',
  '.sh',
  '.zsh',
  '.sql',
  '.log',
  '.env',
  '.ini',
  '.conf',
  '.diff',
  '.patch',
];

export const ATTACHMENT_ACCEPT = [...ATTACHMENT_IMAGE_TYPES, 'text/*', ...TEXT_EXTENSIONS].join(
  ',',
);

type Classified = { kind: AttachmentKind; mediaType: string } | { error: string };

function isImageType(type: string): type is (typeof ATTACHMENT_IMAGE_TYPES)[number] {
  return (ATTACHMENT_IMAGE_TYPES as readonly string[]).includes(type);
}

function hasTextExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return TEXT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function isTextType(type: string): boolean {
  return type.startsWith('text/') || TEXT_MEDIA_TYPES.has(type);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function classifyFile(file: File): Classified {
  if (file.name.length > ATTACHMENT_NAME_MAX_LENGTH) {
    return { error: `File names can be at most ${ATTACHMENT_NAME_MAX_LENGTH} characters.` };
  }
  if (isImageType(file.type)) {
    if (file.size > ATTACHMENT_IMAGE_MAX_BYTES) {
      return { error: `Images can be up to ${formatBytes(ATTACHMENT_IMAGE_MAX_BYTES)}.` };
    }
    return { kind: 'image', mediaType: file.type };
  }
  if (file.type.startsWith('image/')) {
    return { error: 'Use a PNG, JPEG, GIF or WebP image.' };
  }
  if (!isTextType(file.type) && !hasTextExtension(file.name)) {
    return { error: 'Only images and text files can be attached.' };
  }
  if (file.size > ATTACHMENT_TEXT_MAX_BYTES) {
    return { error: `Text files can be up to ${formatBytes(ATTACHMENT_TEXT_MAX_BYTES)}.` };
  }
  return { kind: 'text', mediaType: file.type.startsWith('text/') ? file.type : 'text/plain' };
}

export function attachmentUrl(id: string): string {
  return `/api${attachmentContentPath(id)}`;
}

interface UploadOptions {
  mediaType: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

function errorMessage(xhr: XMLHttpRequest): string {
  try {
    const payload: unknown = JSON.parse(xhr.responseText);
    if (
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
    ) {
      return payload.error;
    }
  } catch {
    return xhr.status === 413 ? 'This file is too large.' : `Upload failed (${xhr.status}).`;
  }
  return `Upload failed (${xhr.status}).`;
}

export function uploadAttachment(file: File, options: UploadOptions): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/attachments');
    xhr.setRequestHeader('Content-Type', options.mediaType);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(xhr.status, errorMessage(xhr)));
        return;
      }
      try {
        resolve(attachmentSchema.parse(JSON.parse(xhr.responseText)));
      } catch {
        reject(new ApiError(xhr.status, 'The server sent an unexpected response.'));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed. Check your connection.'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
