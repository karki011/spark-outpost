import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_FILE_MAX_BYTES,
  ATTACHMENT_IMAGE_MAX_BYTES,
  ATTACHMENT_NAME_MAX_LENGTH,
  ATTACHMENT_TEXT_MAX_BYTES,
} from '@spark-outpost/contracts';
import { classifyAttachment, sanitizeAttachmentName } from './attachment-content.ts';

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

  it('keeps a declared image whose bytes are not an image as an opaque file', () => {
    expect(classifyAttachment('a.png', 'image/png', bytes([0xff, 0x00, 0xfe]))).toEqual({
      name: 'a.png',
      mediaType: 'application/octet-stream',
      kind: 'file',
    });
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

  it('rejects empty files and files over the file limit', () => {
    expect(() => classifyAttachment('a.txt', 'text/plain', Buffer.alloc(0))).toThrow('empty');
    const big = Buffer.alloc(ATTACHMENT_FILE_MAX_BYTES + 1, 'a');
    expect(() => classifyAttachment('a.txt', 'text/plain', big)).toThrow(
      'Files must be 20 MB or smaller.',
    );
  });

  it('refuses secret file names for every kind', () => {
    expect(() => classifyAttachment('.env', 'text/plain', Buffer.from('A=1'))).toThrow();
    expect(() => classifyAttachment('.env', 'application/pdf', bytes([0xc3, 0x28]))).toThrow();
  });

  it('keeps text larger than the text limit as a file', () => {
    const csv = Buffer.alloc(3 * 1024 * 1024, 'a,b\n');
    expect(classifyAttachment('big.csv', 'text/csv', csv)).toEqual({
      name: 'big.csv',
      mediaType: 'text/csv',
      kind: 'file',
    });
    const edge = Buffer.alloc(ATTACHMENT_TEXT_MAX_BYTES + 1, 'a');
    expect(classifyAttachment('edge.txt', '', edge)).toMatchObject({
      kind: 'file',
      mediaType: 'application/octet-stream',
    });
    expect(
      classifyAttachment('ok.txt', '', Buffer.alloc(ATTACHMENT_TEXT_MAX_BYTES, 'a')).kind,
    ).toBe('text');
  });

  it('classifies binary data as a file and accepts exactly the file limit', () => {
    expect(
      classifyAttachment('a.bin', 'application/octet-stream', bytes([0xc3, 0x28])),
    ).toMatchObject({ kind: 'file', mediaType: 'application/octet-stream' });
    expect(classifyAttachment('a.txt', 'text/plain', Buffer.from('a\u0000b'))).toMatchObject({
      kind: 'file',
    });
    const limit = bytes([0x50, 0x4b], ATTACHMENT_FILE_MAX_BYTES);
    expect(classifyAttachment('a.zip', 'application/zip', limit)).toMatchObject({
      kind: 'file',
      mediaType: 'application/zip',
    });
  });

  it('marks a PDF only when the declared type and the magic bytes agree', () => {
    const pdf = Buffer.from('%PDF-1.7\n\u00e9\u0000');
    expect(classifyAttachment('a.pdf', 'application/pdf', pdf)).toEqual({
      name: 'a.pdf',
      mediaType: 'application/pdf',
      kind: 'file',
    });
    expect(
      classifyAttachment('ascii.pdf', 'application/pdf', Buffer.from('%PDF-1.4 text')),
    ).toEqual({
      name: 'ascii.pdf',
      mediaType: 'application/pdf',
      kind: 'file',
    });
    expect(classifyAttachment('a.pdf', 'application/pdf', bytes([0xc3, 0x28]))).toMatchObject({
      mediaType: 'application/octet-stream',
    });
    expect(classifyAttachment('a.pdf', 'application/octet-stream', pdf).mediaType).toBe(
      'application/octet-stream',
    );
  });

  it('keeps a well-formed declared media type and drops a malformed one', () => {
    const data = bytes([0xc3, 0x28]);
    const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    expect(classifyAttachment('a.xlsx', `${xlsx}; charset=x`, data).mediaType).toBe(xlsx);
    expect(classifyAttachment('a.x', 'Application/ZIP', data).mediaType).toBe('application/zip');
    expect(classifyAttachment('a.x', 'not a type', data).mediaType).toBe(
      'application/octet-stream',
    );
    expect(classifyAttachment('a.x', '', data).mediaType).toBe('application/octet-stream');
  });
});
