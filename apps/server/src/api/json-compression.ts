import { gzip } from 'node:zlib';
import type { NextFunction, Request, Response } from 'express';
import { isRemote } from '../remote/principal.ts';

export const COMPRESS_FROM_CHARS = 1024;

function acceptsGzip(req: Request): boolean {
  return /\bgzip\b/i.test(String(req.headers['accept-encoding'] ?? ''));
}

function compressible(req: Request, res: Response, body: unknown): body is string {
  return (
    typeof body === 'string' &&
    body.length >= COMPRESS_FROM_CHARS &&
    req.method !== 'HEAD' &&
    isRemote(res) &&
    acceptsGzip(req) &&
    !res.headersSent &&
    !res.getHeader('Content-Encoding') &&
    String(res.getHeader('Content-Type') ?? '').includes('application/json')
  );
}

export function compressRemoteJson() {
  return (req: Request, res: Response, next: NextFunction) => {
    const send = res.send.bind(res);
    res.send = (body?: unknown) => {
      if (!compressible(req, res, body)) return send(body);
      gzip(body, (error, packed) => {
        if (res.headersSent || res.destroyed) return;
        if (error) {
          send(body);
          return;
        }
        res.setHeader('Content-Encoding', 'gzip');
        res.vary('Accept-Encoding');
        send(packed);
      });
      return res;
    };
    next();
  };
}
