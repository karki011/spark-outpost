import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_FILE_MAX_BYTES,
  ATTACHMENT_IMAGE_MAX_BYTES,
  ATTACHMENT_TEXT_MAX_BYTES,
} from '@spark-outpost/contracts';
import { classifyFile, formatBytes } from './attachments.ts';

function file(name: string, type: string, size = 10): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('classifyFile', () => {
  it('accepts supported images and text files', () => {
    expect(classifyFile(file('a.png', 'image/png'))).toEqual({
      kind: 'image',
      mediaType: 'image/png',
    });
    expect(classifyFile(file('notes.md', 'text/markdown'))).toEqual({
      kind: 'text',
      mediaType: 'text/markdown',
    });
  });

  it('treats source files by extension as plain text', () => {
    expect(classifyFile(file('main.ts', 'video/mp2t'))).toEqual({
      kind: 'text',
      mediaType: 'text/plain',
    });
    expect(classifyFile(file('data.json', 'application/json'))).toEqual({
      kind: 'text',
      mediaType: 'text/plain',
    });
  });

  it('keeps everything else as a file, including text over the text limit', () => {
    expect(classifyFile(file('photo.heic', 'image/heic'))).toEqual({
      kind: 'file',
      mediaType: 'image/heic',
    });
    expect(classifyFile(file('report.pdf', 'application/pdf'))).toEqual({
      kind: 'file',
      mediaType: 'application/pdf',
    });
    expect(classifyFile(file('book.xlsx', ''))).toEqual({
      kind: 'file',
      mediaType: 'application/octet-stream',
    });
    expect(classifyFile(file('big.csv', 'text/csv', 3 * 1024 * 1024))).toEqual({
      kind: 'file',
      mediaType: 'text/csv',
    });
    expect(classifyFile(file('big.txt', 'text/plain', ATTACHMENT_TEXT_MAX_BYTES + 1))).toEqual({
      kind: 'file',
      mediaType: 'text/plain',
    });
  });

  it('rejects secret names and oversized files with friendly messages', () => {
    expect(classifyFile(file('.env', 'text/plain'))).toHaveProperty('error');
    expect(classifyFile(file('big.png', 'image/png', ATTACHMENT_IMAGE_MAX_BYTES + 1))).toEqual({
      error: 'Images can be up to 5.0 MB.',
    });
    expect(classifyFile(file('big.zip', 'application/zip', ATTACHMENT_FILE_MAX_BYTES + 1))).toEqual(
      { error: 'Files must be 20 MB or smaller.' },
    );
  });
});

describe('formatBytes', () => {
  it('uses readable units', () => {
    expect(formatBytes(18)).toBe('18 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
