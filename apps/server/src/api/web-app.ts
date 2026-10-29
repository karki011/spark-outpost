import express, { type NextFunction, type Request, type Response } from 'express';
import { CONTENT_SECURITY_POLICY_HEADER } from '@spark-outpost/contracts';

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
  const serveFile = express.static(root, { index: false });
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
    res.sendFile('index.html', { root });
  });
  return { files, page };
}
