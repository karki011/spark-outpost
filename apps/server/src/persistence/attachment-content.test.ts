import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_IMAGE_MAX_BYTES,
  ATTACHMENT_NAME_MAX_LENGTH,
  ATTACHMENT_TEXT_MAX_BYTES,
} from '@spark-outpost/contracts';
import {
  UNSUPPORTED_ATTACHMENT,
  classifyAttachment,
  sanitizeAttachmentName,
} from './attachment-content.ts';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const bytes = (values: number[], total = values.length) => {
  const data = Buffer.alloc(total, 1);
  data.set(values);
  return data;
};

describe('attachment names', () => {
  it('keeps only the base name without control characters', () => {
    expect(sanitizeAttachmentName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeAttachmentName('C:\\Users\\me\\report\u0000.txt ')).toBe('report.txt');
    expect(sanitizeAttachmentName('evil\u202egnp.exe')).toBe('evilgnp.exe');
  });

  it('falls back when nothing usable is left', () => {
    expect(sanitizeAttachmentName('')).toBe('attachment');
    expect(sanitizeAttachmentName('dir/')).toBe('attachment');
    expect(sanitizeAttachmentName('..')).toBe('attachment');
  });

  it('caps the length', () => {
    expect(sanitizeAttachmentName('a'.repeat(500))).toHaveLength(ATTACHMENT_NAME_MAX_LENGTH);
  });
});

describe('attachment classification', () => {
  it('accepts images whose bytes match the declared type', () => {
    expect(classifyAttachment('a.png', 'image/png', bytes(PNG))).toEqual({
      name: 'a.png',
      mediaType: 'image/png',
      kind: 'image',
    });
    expect(classifyAttachment('a.gif', 'image/gif', Buffer.from('GIF89a..'))).toMatchObject({
      kind: 'image',
    });
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
    expect(classifyAttachment('a.webp', 'image/webp', webp)).toMatchObject({ kind: 'image' });
  });

  it('rejects a declared image whose bytes are not an image', () => {
    expect(() => classifyAttachment('a.png', 'image/png', bytes([0xff, 0x00, 0xfe]))).toThrow(
      UNSUPPORTED_ATTACHMENT,
    );
  });

  it('rejects oversized images', () => {
    const big = bytes([0xff, 0xd8, 0xff], ATTACHMENT_IMAGE_MAX_BYTES + 1);
    expect(() => classifyAttachment('a.jpg', 'image/jpeg', big)).toThrow('5 MB or smaller');
  });

  it('treats valid UTF-8 as text and keeps textual media types', () => {
    const text = Buffer.from('{"héllo": 1}');
    expect(classifyAttachment('a.json', 'application/json; charset=utf-8', text)).toEqual({
      name: 'a.json',
      mediaType: 'application/json',
      kind: 'text',
    });
    expect(classifyAttachment('a.ts', 'video/mp2t', text).mediaType).toBe('text/plain');
    expect(classifyAttachment('a.md', 'text/markdown', text).mediaType).toBe('text/markdown');
    expect(classifyAttachment('a.txt', '', text).mediaType).toBe('text/plain');
  });

  it('rejects binary data, NUL bytes, empty files and oversized text', () => {
    expect(() =>
      classifyAttachment('a.bin', 'application/octet-stream', bytes([0xc3, 0x28])),
    ).toThrow(UNSUPPORTED_ATTACHMENT);
    expect(() => classifyAttachment('a.txt', 'text/plain', Buffer.from('a\u0000b'))).toThrow(
      UNSUPPORTED_ATTACHMENT,
    );
    expect(() => classifyAttachment('a.txt', 'text/plain', Buffer.alloc(0))).toThrow('empty');
    const big = Buffer.alloc(ATTACHMENT_TEXT_MAX_BYTES + 1, 'a');
    expect(() => classifyAttachment('a.txt', 'text/plain', big)).toThrow('512 KB or smaller');
  });
});
