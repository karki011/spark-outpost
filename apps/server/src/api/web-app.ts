import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { CONTENT_SECURITY_POLICY_HEADER } from '@spark-outpost/contracts';
import { precompressedSuffix } from './precompressed.ts';

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

function isApiPath(req: Request): boolean {
  return req.path.startsWith('/api/');
}

function pagePolicy(policy: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isApiPath(req)) res.setHeader(CONTENT_SECURITY_POLICY_HEADER, policy);
    next();
  };
}

export function webApp(root: string, policy: string) {
  const hashedAssets = path.join(path.resolve(root), 'assets') + path.sep;
  const serveStatic = express.static(root, {
    index: false,
    setHeaders: (res, file) => {
      if (file.startsWith(hashedAssets)) res.setHeader('Cache-Control', IMMUTABLE_CACHE_CONTROL);
    },
  });
  const serveFile = (req: Request, res: Response, next: NextFunction) => {
    const suffix = precompressedSuffix(root, req.path, req, res);
    if (suffix) req.url = req.path + suffix + req.url.slice(req.path.length);
    serveStatic(req, res, next);
  };
  const files = express.Router();
  files.use(pagePolicy(policy));
  files.use((req: Request, res: Response, next: NextFunction) => {
    if (isApiPath(req)) next();
    else serveFile(req, res, next);
  });
  const page = express.Router();
  page.use(pagePolicy(policy));
  page.get('/{*path}', (req: Request, res: Response, next: NextFunction) => {
    if (isApiPath(req)) {
      next();
      return;
    }
    const suffix = precompressedSuffix(root, '/index.html', req, res);
    res.sendFile(`index.html${suffix}`, { root });
  });
  return { files, page };
}
