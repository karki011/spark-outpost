export const UNKNOWN_HOST = '?';

const LOCAL_HOST =
  /^(?:localhost|[\w.-]+\.localhost|127(?:\.\d{1,3}){1,3}|0\.0\.0\.0|::1|\[::1\])$/i;
const URL_WORD = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/\s]*@)?(\[[^\]\s]+\]|[^/:?#\s]*)/i;
const URL_AUTHORITY = /^[a-z][a-z0-9+.-]*:\/\/[^/?#\s]*/i;
const FILE_URL = /^file:\/\//i;
const REMOTE_WORD = /^(?:[\w.+-]+@)?(\[[0-9a-f:.]+\]|[a-z0-9][\w.-]*):(?!\/\/)/i;
const USER_AT_HOST = /^[\w.+-]+@(\[[0-9a-f:.]+\]|[a-z0-9][\w.-]*)(?::\d+)?$/i;
const BARE_HOST =
  /^(\[[0-9a-f:.]+\]|localhost|\d{1,3}(?:\.\d{1,3}){3}|(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*)(?::\d+)?(?:\/\S*)?$/i;
const UNRESOLVED = /\$|`/;
const DEV_NET = /\/dev\/(?:tcp|udp)\/([^/\s'"]+)/g;

export function isLocalHost(host: string): boolean {
  return LOCAL_HOST.test(host);
}

export function urlHost(word: string): string | null {
  if (FILE_URL.test(word)) return 'localhost';
  const match = URL_WORD.exec(word);
  if (!match) return null;
  const host = match[1] ?? '';
  return host === '' || UNRESOLVED.test(host) ? UNKNOWN_HOST : host.toLowerCase();
}

export function remoteHost(word: string): string | null {
  const url = urlHost(word);
  if (url) return url;
  if (word.startsWith('/') || word.startsWith('.')) return null;
  const match = REMOTE_WORD.exec(word) ?? USER_AT_HOST.exec(word);
  return match ? match[1]!.toLowerCase() : null;
}

export function bareHost(word: string): string | null {
  const remote = remoteHost(word);
  if (remote) return remote;
  const match = BARE_HOST.exec(word.replace(/^@/, ''));
  return match ? match[1]!.toLowerCase() : null;
}

export function unresolved(word: string): boolean {
  return UNRESOLVED.test(word);
}

export function resolvedUrlHost(word: string): string | null {
  const authority = URL_AUTHORITY.exec(word)?.[0];
  if (!authority || UNRESOLVED.test(authority)) return null;
  return urlHost(word);
}

export function devNetHosts(command: string): string[] {
  return [...command.matchAll(DEV_NET)].map(([, host]) =>
    UNRESOLVED.test(host!) ? UNKNOWN_HOST : host!.toLowerCase(),
  );
}

export function codeHosts(code: string): string[] {
  const urls = code.match(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`)]+/gi) ?? [];
  return urls.flatMap((url) => urlHost(url) ?? []);
}

export function remoteHosts(hosts: readonly string[]): string[] {
  return [...new Set(hosts.filter((host) => !isLocalHost(host)))];
}
