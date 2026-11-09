import type { Response } from 'express';
import { parseBrowserUrl } from '@spark-outpost/contracts';

const DATA_PREFIX = 'data: ';

export function addressOrigin(url: string): string {
  const origin = parseBrowserUrl(url.trim())?.origin;
  return origin && origin !== 'null' ? origin : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asksToOpen(value: Record<string, unknown>): boolean {
  return value.mode === 'url' && typeof value.url === 'string' && 'elicitationId' in value;
}

function cutAddress(value: Record<string, unknown>): Record<string, unknown> {
  return typeof value.url === 'string' ? { ...value, url: addressOrigin(value.url) } : value;
}

export function withAddressOrigins(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withAddressOrigins);
  if (!isRecord(value)) return value;
  const walked: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const inner = withAddressOrigins(entry);
    walked[key] = key === 'openAddress' && isRecord(inner) ? cutAddress(inner) : inner;
  }
  return asksToOpen(walked) ? cutAddress(walked) : walked;
}

function lineWithOrigins(line: string): string {
  if (!line.includes('"url"')) return line;
  const prefix = line.startsWith(DATA_PREFIX) ? DATA_PREFIX : '';
  try {
    const parsed: unknown = JSON.parse(line.slice(prefix.length));
    return `${prefix}${JSON.stringify(withAddressOrigins(parsed))}`;
  } catch {
    return line;
  }
}

export function textWithAddressOrigins(text: string): string {
  if (!text.includes('"url"')) return text;
  return text.split('\n').map(lineWithOrigins).join('\n');
}

type Write = Response['write'];

export function servesAddressOrigins(res: Response): void {
  const json = res.json.bind(res);
  res.json = (body?: unknown) => json(withAddressOrigins(body));
  const write: Write = res.write.bind(res);
  res.write = ((chunk: unknown, ...rest: unknown[]) => {
    const text = typeof chunk === 'string' ? textWithAddressOrigins(chunk) : chunk;
    return (write as (...args: unknown[]) => boolean)(text, ...rest);
  }) as Write;
}
