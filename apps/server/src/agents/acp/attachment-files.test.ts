import { readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TurnAttachment } from '../../providers/provider.ts';
import { createAttachmentFolder } from './attachment-files.ts';

const file = (name: string, content: string, mediaType = 'application/zip'): TurnAttachment => ({
  name,
  mediaType,
  kind: 'file',
  data: Buffer.from(content),
});
const support = { image: true, embeddedContext: true, pdf: true };

describe('attachment folder', () => {
  it('writes private files, dedupes names, and removes the folder', async () => {
    const folder = createAttachmentFolder(true);
    const first = file('data.zip', 'one');
    const second = file('data.zip', 'two');
    const paths = await folder.prepare([first, second], support);
    const [one, two] = [paths.get(first)!, paths.get(second)!];
    expect(one).not.toBe(two);
    expect(await readFile(one, 'utf8')).toBe('one');
    expect(await readFile(two, 'utf8')).toBe('two');
    expect((await stat(one)).mode & 0o777).toBe(0o600);
    expect((await stat(dirname(one))).mode & 0o777).toBe(0o700);
    const later = file('data.zip', 'three');
    const more = await folder.prepare([later], support);
    expect(more.get(later)).not.toBe(one);
    expect(dirname(more.get(later)!)).toBe(dirname(one));
    await folder.remove();
    await expect(stat(dirname(one))).rejects.toThrow();
  });

  it('does not write inline PDFs, text, or anything when the turn cannot read files', async () => {
    const pdf: TurnAttachment = { ...file('a.pdf', '%PDF-1'), mediaType: 'application/pdf' };
    const folder = createAttachmentFolder(true);
    expect((await folder.prepare([pdf], support)).size).toBe(0);
    const blind = createAttachmentFolder(false);
    expect((await blind.prepare([file('a.zip', 'x')], support)).size).toBe(0);
    await folder.remove();
    await blind.remove();
  });

  it('writes nothing after it is removed', async () => {
    const folder = createAttachmentFolder(true);
    await folder.remove();
    expect((await folder.prepare([file('a.zip', 'x')], support)).size).toBe(0);
  });
});
