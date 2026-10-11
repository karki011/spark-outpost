import path from 'node:path';
import { PREVIEW_LOG_TAIL_MAX, type PreviewConfig } from '@spark-outpost/contracts';
import { childEnvironment } from '../setup/environment.ts';

export const PORT_TRIES = 20;
const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 };
const SPARK_OWN = /^(?:SPARK_|API_(?:PORT|HOST)$|ALLOWED_ORIGINS$|WEB_ROOT$|BACKUP_DIR$|PORT$)/;

export function commandEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const kept = Object.entries(childEnvironment(env)).filter(([name]) => !SPARK_OWN.test(name));
  return { ...Object.fromEntries(kept), TERM: 'xterm-256color', COLORTERM: 'truecolor' };
}

export function previewEnvironment(env: NodeJS.ProcessEnv, port: number): Record<string, string> {
  return { ...commandEnvironment(env), PORT: String(port) };
}

export function portOf(url: string): number {
  const parsed = new URL(url);
  return parsed.port ? Number(parsed.port) : (DEFAULT_PORTS[parsed.protocol] ?? 80);
}

export function withPort(url: string, port: number): string {
  const parsed = new URL(url);
  parsed.port = String(port);
  return parsed.toString();
}

export async function freePortFrom(
  first: number,
  free: (port: number) => Promise<boolean>,
): Promise<{ port: number; busy: number[] } | null> {
  const busy: number[] = [];
  for (let port = first; port < first + PORT_TRIES && port <= 65_535; port += 1) {
    if (await free(port)) return { port, busy };
    busy.push(port);
  }
  return null;
}

const ANSI =
  // eslint-disable-next-line no-control-regex
  /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
const LOCAL_ADDRESS = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})/g;

export function plainOutput(output: string): string {
  return output.replace(ANSI, '').replace(/\r\n?/g, '\n');
}

export function printedPorts(output: string): number[] {
  const ports = [...plainOutput(output).matchAll(LOCAL_ADDRESS)].map((match) => Number(match[1]));
  return [...new Set(ports.reverse())];
}

export function probeTargets(
  config: Pick<PreviewConfig, 'url' | 'readyUrl'>,
  port: number,
  busy: readonly number[],
  output: string,
): { probe: string; url: string }[] {
  const ports = [port, ...printedPorts(output).filter((seen) => seen !== port)];
  return ports
    .filter((candidate) => !busy.includes(candidate))
    .map((candidate) => ({
      probe: withPort(config.readyUrl ?? config.url, candidate),
      url: withPort(config.url, candidate),
    }));
}

export function workingFolder(base: string, folder: string | null): string | null {
  const target = path.resolve(base, folder ?? '.');
  const inside = target === base || target.startsWith(`${base}${path.sep}`);
  return inside ? target : null;
}

export function logTail(output: string, max = PREVIEW_LOG_TAIL_MAX): string {
  const plain = plainOutput(output);
  if (plain.length <= max) return plain;
  const cut = plain.slice(-max);
  const firstBreak = cut.indexOf('\n');
  return firstBreak === -1 ? cut : cut.slice(firstBreak + 1);
}

export function lastLines(text: string, count: number): string {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(-count)
    .join('\n');
}
