import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { ATTACHMENT_IMAGE_MAX_BYTES } from '@spark-outpost/contracts';
import { getAttachmentContent, saveAttachment } from '../persistence/attachments.ts';
import type { Db } from '../persistence/db.ts';
import { UploadTooLargeError, isTooLarge, paramId } from './validation.ts';
import { UPLOAD_NAME_HEADER } from './security.ts';
import { contentDisposition } from './content-disposition.ts';

export interface AttachmentRouteDeps {
  db: Db;
  workspaceId: string;
}

const rawBody = express.raw({ type: () => true, limit: ATTACHMENT_IMAGE_MAX_BYTES });

function readUpload(req: Request, res: Response, next: NextFunction) {
  rawBody(req, res, (error?: unknown) => {
    next(isTooLarge(error) ? new UploadTooLargeError(ATTACHMENT_IMAGE_MAX_BYTES) : error);
  });
}

function uploadName(req: Request): string {
  const header = req.headers[UPLOAD_NAME_HEADER];
  const raw = Array.isArray(header) ? (header[0] ?? '') : (header ?? '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function attachmentRoutes({ db, workspaceId }: AttachmentRouteDeps): Router {
  const router = Router();

  router.post('/attachments', readUpload, async (req, res) => {
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const attachment = await saveAttachment(db, workspaceId, {
      name: uploadName(req),
      mediaType: req.headers['content-type'] ?? '',
      data,
    });
    res.status(201).json(attachment);
  });

  router.get('/attachments/:id/content', async (req, res) => {
    const file = await getAttachmentContent(db, workspaceId, paramId(req));
    if (!file) {
      res.status(404).json({ error: 'Attachment not found.' });
      return;
    }
    res.set({
      'Content-Type': file.kind === 'image' ? file.mediaType : 'text/plain; charset=utf-8',
      'Content-Length': String(file.data.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': contentDisposition('inline', file.name),
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    res.end(file.data);
  });

  return router;
}
