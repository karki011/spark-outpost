import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  API_TOKEN_HEADER,
  classifyBrowserUrl,
  parseBrowserUrl,
  type ParsedUrl,
} from '@spark-outpost/contracts';

const DEFAULT_PORTS: Record<string, number> = {
  'http:': 80,
  'https:': 443,
  'ws:': 80,
  'wss:': 443,
};
const PAGE_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'data:', 'blob:', 'about:']);
export const BROWSER_PARTITION = 'persist:spark-browser-profile';

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

export const AGENT_OPEN_REFUSALS = {
  address:
    'That is not a web address the browser can open. Use http or https, with no username or password in it.',
  file: 'Agents can open files inside this chat’s projects only.',
  sparkPort:
    'That address is on one of Spark’s own ports, which no page in the Browser pane may reach.',
} as const;

export function agentOpenProblem(value: string, facts: GuardFacts): string | null {
  const kind = classifyBrowserUrl(value);
  if (kind === 'blocked' || kind === 'blank') return AGENT_OPEN_REFUSALS.address;
  if (requestAllowed(value, facts)) return null;
  return kind === 'file' ? AGENT_OPEN_REFUSALS.file : AGENT_OPEN_REFUSALS.sparkPort;
}

export function navigationAllowed(value: string): boolean {
  return classifyBrowserUrl(value) !== 'blocked';
}

export function withoutSparkToken(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== API_TOKEN_HEADER),
  );
}
