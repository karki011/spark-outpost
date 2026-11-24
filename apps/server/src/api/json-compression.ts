import { gzip } from 'node:zlib';
import type { NextFunction, Request, Response } from 'express';
import { isRemote } from '../remote/principal.ts';

export const COMPRESS_FROM_CHARS = 1024;

function quality(parameters: readonly string[]): number {
  for (const parameter of parameters) {
    const [name, value] = parameter.split('=').map((part) => part.trim());
    if (name?.toLowerCase() !== 'q') continue;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 1;
}

export function acceptsGzip(header: string): boolean {
  for (const entry of header.split(',')) {
    const [coding, ...parameters] = entry.split(';');
    if (coding?.trim().toLowerCase() === 'gzip') return quality(parameters) > 0;
  }
  return false;
}

function compressible(req: Request, res: Response, body: unknown): body is string {
  return (
    typeof body === 'string' &&
    body.length >= COMPRESS_FROM_CHARS &&
    req.method !== 'HEAD' &&
    isRemote(res) &&
    acceptsGzip(String(req.headers['accept-encoding'] ?? '')) &&
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
