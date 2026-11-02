import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { Router } from 'express';
import { chatKeptFolder } from '../chat-files/folders.ts';
import { findChatFile } from '../chat-files/store.ts';
import type { Db } from '../persistence/db.ts';
import { contentDisposition } from './content-disposition.ts';
import { paramId } from './validation.ts';

export interface ChatFileRouteDeps {
  db: Db;
  workspaceId: string;
  chatFolders?: string;
}

const READABLE_TYPES: ReadonlySet<string> = new Set([
  'text/csv',
  'text/tab-separated-values',
  'text/markdown',
  'text/plain',
  'text/html',
  'image/svg+xml',
  'application/json',
]);

async function keptCopy(path: string): Promise<Buffer | null> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
  if (!handle) return null;
  try {
    const stats = await handle.stat();
    return stats.isFile() ? await handle.readFile() : null;
  } finally {
    await handle.close();
  }
}

function shownAs(kind: 'image' | 'file', mediaType: string, download: boolean) {
  if (download) return { type: 'application/octet-stream', disposition: 'attachment' } as const;
  if (kind === 'image') return { type: mediaType, disposition: 'inline' } as const;
  if (READABLE_TYPES.has(mediaType)) {
    return { type: 'text/plain; charset=utf-8', disposition: 'inline' } as const;
  }
  return { type: 'application/octet-stream', disposition: 'attachment' } as const;
}

export function chatFileRoutes({ db, workspaceId, chatFolders }: ChatFileRouteDeps): Router {
  const router = Router();

  router.get('/chat-files/:id/content', async (req, res) => {
    const stored = chatFolders ? await findChatFile(db, workspaceId, paramId(req)) : null;
    const data =
      chatFolders && stored
        ? await keptCopy(join(chatKeptFolder(chatFolders, stored.conversationId), stored.file.id))
        : null;
    if (!stored || !data) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }
    const { file } = stored;
    const shown = shownAs(file.kind, file.mediaType, req.query.download === '1');
    res.set({
      'Content-Type': shown.type,
      'Content-Length': String(data.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': contentDisposition(shown.disposition, file.name),
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    res.end(data);
  });

  return router;
}
