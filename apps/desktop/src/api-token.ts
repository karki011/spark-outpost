import { API_TOKEN_HEADER } from '@spark-outpost/contracts';

const SOCKET_SCHEMES: Record<string, string> = { 'ws:': 'http:', 'wss:': 'https:' };

export function apiOrigin(host: string, port: number): string {
  return `http://${host}:${port}`;
}

export function targetsApi(url: string, origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const scheme = SOCKET_SCHEMES[parsed.protocol] ?? parsed.protocol;
  return `${scheme}//${parsed.host}` === origin;
}

export function withApiToken(
  headers: Record<string, string>,
  url: string,
  origin: string,
  token: string,
): Record<string, string> {
  const rest = Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== API_TOKEN_HEADER),
  );
  return targetsApi(url, origin) ? { ...rest, [API_TOKEN_HEADER]: token } : rest;
}
