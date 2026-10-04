import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_TOKEN_HEADER, parseBrowserUrl, type ParsedUrl } from '@spark-outpost/contracts';

const DEFAULT_PORTS: Record<string, number> = {
  'http:': 80,
  'https:': 443,
  'ws:': 80,
  'wss:': 443,
};
const PAGE_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'data:', 'blob:', 'about:']);
const PARTITION_PREFIX = 'spark-browser-';

export interface GuardFacts {
  blockedPorts: ReadonlySet<number>;
  roots: readonly string[];
}

export function portOf(url: ParsedUrl): number | null {
  if (url.port !== '') return Number(url.port);
  return DEFAULT_PORTS[url.protocol] ?? null;
}

export function insideRoots(file: string, roots: readonly string[]): boolean {
  const resolved = path.resolve(file);
  return roots.some((root) => {
    const base = path.resolve(root);
    return resolved === base || resolved.startsWith(`${base}${path.sep}`);
  });
}

function fileAllowed(url: ParsedUrl, roots: readonly string[]): boolean {
  if (url.hostname !== '' && url.hostname !== 'localhost') return false;
  try {
    return insideRoots(fileURLToPath(url.href), roots);
  } catch {
    return false;
  }
}

export function requestAllowed(value: string, facts: GuardFacts): boolean {
  const url = parseBrowserUrl(value);
  if (!url) return false;
  if (url.protocol === 'file:') return fileAllowed(url, facts.roots);
  if (!PAGE_SCHEMES.has(url.protocol)) return false;
  const port = portOf(url);
  return port === null || !facts.blockedPorts.has(port);
}

export function withoutSparkToken(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== API_TOKEN_HEADER),
  );
}

export interface PartitionChoice {
  chatId: string;
  projectId: string | null;
  keepSignIns: boolean;
}

const SAFE_ID = /^[0-9a-f-]{36}$/i;

export function projectPartition(projectId: string): string {
  if (!SAFE_ID.test(projectId)) throw new Error('A browser partition needs a project id.');
  return `persist:${PARTITION_PREFIX}${projectId}`;
}

export function partitionFor(choice: PartitionChoice): string {
  if (choice.projectId && choice.keepSignIns) return projectPartition(choice.projectId);
  if (!SAFE_ID.test(choice.chatId)) throw new Error('A browser partition needs a chat id.');
  return `${PARTITION_PREFIX}chat-${choice.chatId}`;
}

export function isBrowserPartition(name: string): boolean {
  return name.startsWith(PARTITION_PREFIX) || name.startsWith(`persist:${PARTITION_PREFIX}`);
}
