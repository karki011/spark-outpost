import { lstat, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TurnAttachment } from '../../providers/provider.ts';
import {
  filesToWrite,
  uniqueFileNames,
  type AttachmentPaths,
  type PromptSupport,
} from './attachment-parts.ts';

export interface AttachmentFolder {
  prepare(attachments: readonly TurnAttachment[], support: PromptSupport): Promise<AttachmentPaths>;
  files(): Promise<string[]>;
  remove(): Promise<void>;
}

async function plainFile(path: string): Promise<string[]> {
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile()) return [];
  const real = await realpath(path).catch(() => null);
  return real === null ? [] : [...new Set([path, real])];
}

export function createAttachmentFolder(canRead: boolean): AttachmentFolder {
  let folder: string | null = null;
  let closed = false;
  const written = new Set<string>();
  let queue: Promise<unknown> = Promise.resolve();

  const write = async (
    attachments: readonly TurnAttachment[],
    support: PromptSupport,
  ): Promise<AttachmentPaths> => {
    const pending = filesToWrite(attachments, support, canRead);
    const paths = new Map<TurnAttachment, string>();
    if (pending.length === 0 || closed) return paths;
    folder ??= await mkdtemp(join(tmpdir(), 'spark-attach-'));
    for (const [attachment, name] of uniqueFileNames(pending, written)) {
      const path = join(folder, name);
      await writeFile(path, attachment.data, { mode: 0o600, flag: 'wx' });
      written.add(name);
      paths.set(attachment, path);
    }
    return paths;
  };

  return {
    prepare(attachments, support) {
      const result = queue.then(() => write(attachments, support));
      queue = result.catch(() => undefined);
      return result;
    },
    async files() {
      await queue;
      const paths = folder === null ? [] : [...written].map((name) => join(folder!, name));
      return (await Promise.all(paths.map(plainFile))).flat();
    },
    async remove() {
      closed = true;
      await queue;
      if (folder) await rm(folder, { recursive: true, force: true });
      folder = null;
    },
  };
}
