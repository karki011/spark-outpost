import type { NextFunction, Request, Response } from 'express';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const UPLOAD_PATH = '/api/attachments';
export const UPLOAD_NAME_HEADER = 'x-file-name';

function isUpload(req: Request): boolean {
  return req.method === 'POST' && req.path === UPLOAD_PATH;
}

export function localRequestGuard(port: number, allowedOrigins: readonly string[]) {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set(allowedOrigins);

  return (req: Request, res: Response, next: NextFunction) => {
    if (!allowedHosts.has(req.headers.host ?? '')) {
      res.status(403).json({ error: 'Requests must target the local API host.' });
      return;
    }
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) {
      res.status(403).json({ error: 'This origin is not allowed.' });
      return;
    }
    if (isUpload(req)) {
      if (req.headers[UPLOAD_NAME_HEADER] === undefined) {
        res.status(400).json({ error: 'Send the file name in the X-File-Name header.' });
        return;
      }
      next();
      return;
    }
    if (MUTATING_METHODS.has(req.method) && !req.is('application/json')) {
      res.status(415).json({ error: 'Send JSON with Content-Type: application/json.' });
      return;
    }
    next();
  };
}
