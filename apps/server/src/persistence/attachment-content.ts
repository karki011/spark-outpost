import {
  ATTACHMENT_IMAGE_MAX_BYTES,
  ATTACHMENT_IMAGE_TYPES,
  ATTACHMENT_NAME_MAX_LENGTH,
  ATTACHMENT_TEXT_MAX_BYTES,
  isSecretFileName,
  SECRET_FILE_REFUSAL,
  type AttachmentKind,
} from '@spark-outpost/contracts';

export class AttachmentError extends Error {}

export const UNSUPPORTED_ATTACHMENT =
  'Only images (PNG, JPEG, GIF, WebP) and text files are supported.';

const FALLBACK_NAME = 'attachment';
const TEXT_APPLICATION_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/javascript',
  'application/ecmascript',
  'application/typescript',
  'application/x-typescript',
  'application/x-javascript',
  'application/x-sh',
  'application/x-shellscript',
  'application/sql',
  'application/toml',
  'application/yaml',
  'application/x-yaml',
  'application/x-ndjson',
  'application/graphql',
]);

type ImageType = (typeof ATTACHMENT_IMAGE_TYPES)[number];

const startsWith = (data: Uint8Array, bytes: readonly number[], offset = 0) =>
  data.length >= offset + bytes.length &&
  bytes.every((byte, index) => data[offset + index] === byte);

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

const imageSignatures: Record<ImageType, (data: Uint8Array) => boolean> = {
  'image/png': (data) => startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': (data) => startsWith(data, [0xff, 0xd8, 0xff]),
  'image/gif': (data) => startsWith(data, ascii('GIF87a')) || startsWith(data, ascii('GIF89a')),
  'image/webp': (data) => startsWith(data, ascii('RIFF')) && startsWith(data, ascii('WEBP'), 8),
};

export interface ClassifiedAttachment {
  name: string;
  mediaType: string;
  kind: AttachmentKind;
}

export function sanitizeAttachmentName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? '';
  const cleaned = base.replace(/[\p{Cc}‎‏‪-‮⁦-⁩]/gu, '').trim();
  const capped = Array.from(cleaned).slice(0, ATTACHMENT_NAME_MAX_LENGTH).join('').trim();
  if (capped === '' || capped === '.' || capped === '..') return FALLBACK_NAME;
  return capped;
}

function baseMediaType(raw: string): string {
  return (raw.split(';')[0] ?? '').trim().toLowerCase();
}

function isImageType(type: string): type is ImageType {
  return (ATTACHMENT_IMAGE_TYPES as readonly string[]).includes(type);
}

function textMediaType(declared: string): string {
  const textual =
    declared.startsWith('text/') ||
    TEXT_APPLICATION_TYPES.has(declared) ||
    /^application\/[\w.-]+\+(json|xml)$/.test(declared);
  return textual && /^[\w.+-]+\/[\w.+-]+$/.test(declared) ? declared : 'text/plain';
}

function isUtf8Text(data: Uint8Array): boolean {
  if (data.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(data);
    return true;
  } catch {
    return false;
  }
}

export function classifyAttachment(
  rawName: string,
  rawMediaType: string,
  data: Uint8Array,
): ClassifiedAttachment {
  const name = sanitizeAttachmentName(rawName);
  if (isSecretFileName(name)) throw new AttachmentError(SECRET_FILE_REFUSAL);
  if (data.length === 0) throw new AttachmentError('The file is empty.');
  const declared = baseMediaType(rawMediaType);
  if (isImageType(declared) && imageSignatures[declared](data)) {
    if (data.length > ATTACHMENT_IMAGE_MAX_BYTES) {
      throw new AttachmentError(
        `Images must be ${megabytes(ATTACHMENT_IMAGE_MAX_BYTES)} or smaller.`,
      );
    }
    return { name, mediaType: declared, kind: 'image' };
  }
  if (!isUtf8Text(data)) throw new AttachmentError(UNSUPPORTED_ATTACHMENT);
  if (data.length > ATTACHMENT_TEXT_MAX_BYTES) {
    throw new AttachmentError(
      `Text files must be ${ATTACHMENT_TEXT_MAX_BYTES / 1024} KB or smaller.`,
    );
  }
  return { name, mediaType: textMediaType(declared), kind: 'text' };
}

function megabytes(bytes: number): string {
  return `${bytes / (1024 * 1024)} MB`;
}
