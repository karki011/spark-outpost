import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';

const ENCODINGS = [
  { name: 'br', suffix: '.br' },
  { name: 'gzip', suffix: '.gz' },
] as const;
const COMPRESSIBLE = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.webmanifest']);

function accepted(header: string | undefined, name: string): boolean {
  if (!header) return false;
  return header.split(',').some((part) => {
    const [token, ...params] = part.trim().toLowerCase().split(';');
    if (token !== name) return false;
    const quality = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
    return quality === undefined || Number(quality.slice(2)) > 0;
  });
}

function requestedFile(root: string, requestPath: string): string | null {
  try {
    const file = path.join(root, decodeURIComponent(requestPath));
    return file.startsWith(root + path.sep) ? file : null;
  } catch {
    return null;
  }
}

export function precompressedSuffix(
  root: string,
  requestPath: string,
  req: Request,
  res: Response,
): string {
  if (req.method !== 'GET' && req.method !== 'HEAD') return '';
  const file = requestedFile(path.resolve(root), requestPath);
  if (!file || !COMPRESSIBLE.has(path.extname(file).toLowerCase())) return '';
  res.vary('Accept-Encoding');
  const header = req.headers['accept-encoding'];
  for (const { name, suffix } of ENCODINGS) {
    if (accepted(header, name) && existsSync(file + suffix)) {
      res.type(path.extname(file));
      res.setHeader('Content-Encoding', name);
      return suffix;
    }
  }
  return '';
}
