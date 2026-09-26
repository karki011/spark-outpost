import { describe, expect, it } from 'vitest';
import { ATTACHMENT_IMAGE_MAX_BYTES, ATTACHMENT_TEXT_MAX_BYTES } from '@spark-outpost/contracts';
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

  it('rejects unsupported types and oversized files with friendly messages', () => {
    expect(classifyFile(file('photo.heic', 'image/heic'))).toEqual({
      error: 'Use a PNG, JPEG, GIF or WebP image.',
    });
    expect(classifyFile(file('archive.zip', 'application/zip'))).toEqual({
      error: 'Only images and text files can be attached.',
    });
    expect(classifyFile(file('big.png', 'image/png', ATTACHMENT_IMAGE_MAX_BYTES + 1))).toEqual({
      error: 'Images can be up to 5.0 MB.',
    });
    expect(classifyFile(file('big.txt', 'text/plain', ATTACHMENT_TEXT_MAX_BYTES + 1))).toEqual({
      error: 'Text files can be up to 512 KB.',
    });
  });
});

describe('formatBytes', () => {
  it('uses readable units', () => {
    expect(formatBytes(18)).toBe('18 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
