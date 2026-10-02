export interface AnalyticsEngineDataPoint {
  blobs: string[];
  doubles: number[];
  indexes: string[];
}

export interface AnalyticsEngineDataset {
  writeDataPoint(point: AnalyticsEngineDataPoint): void;
}

export interface HeartbeatEnv {
  HEARTBEATS: AnalyticsEngineDataset;
}

type CloudflareRequest = Request & { cf?: { country?: unknown } };

export const HEARTBEAT_PATH = '/v1/heartbeat';
export const MAX_BODY_BYTES = 512;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9A-Za-z.]{1,20})?$/;
const COUNTRY = /^[A-Z0-9]{2}$/;
const UNKNOWN_COUNTRY = 'XX';
const OS = ['darwin', 'win32', 'linux'];
const ARCH = ['x64', 'arm64'];
const CHANNEL = ['stable', 'beta', 'dev'];
const FIELDS = ['installId', 'version', 'os', 'arch', 'channel'];

interface Heartbeat {
  installId: string;
  version: string;
  os: string;
  arch: string;
  channel: string;
}

function oneOf(value: unknown, allowed: string[]): value is string {
  return typeof value === 'string' && allowed.includes(value);
}

function matches(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value);
}

export function parseHeartbeat(text: string): Heartbeat | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== FIELDS.length || !keys.every((key) => FIELDS.includes(key))) return null;
  const { installId, version, os, arch, channel } = record;
  if (!matches(installId, UUID_V4) || !matches(version, VERSION)) return null;
  if (!oneOf(os, OS) || !oneOf(arch, ARCH) || !oneOf(channel, CHANNEL)) return null;
  return { installId, version, os, arch, channel };
}

function countryOf(request: CloudflareRequest): string {
  const country = request.cf?.country;
  return matches(country, COUNTRY) ? country : UNKNOWN_COUNTRY;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) return null;
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BODY_BYTES) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function isJson(request: Request): boolean {
  const type = request.headers.get('content-type') ?? '';
  return type.split(';')[0]!.trim().toLowerCase() === 'application/json';
}

const empty = (status: number, headers: HeadersInit = {}) =>
  new Response(null, { status, headers });

export async function handleRequest(request: Request, env: HeartbeatEnv): Promise<Response> {
  if (new URL(request.url).pathname !== HEARTBEAT_PATH) return empty(404);
  if (request.method !== 'POST') return empty(405, { Allow: 'POST' });
  if (!isJson(request)) return empty(400);
  const text = await readBody(request);
  const heartbeat = text === null ? null : parseHeartbeat(text);
  if (!heartbeat) return empty(400);
  env.HEARTBEATS.writeDataPoint({
    blobs: [
      countryOf(request as CloudflareRequest),
      heartbeat.version,
      heartbeat.os,
      heartbeat.arch,
      heartbeat.channel,
    ],
    doubles: [1],
    indexes: [await sha256Hex(heartbeat.installId)],
  });
  return empty(204);
}

export default {
  fetch: (request: Request, env: HeartbeatEnv) => handleRequest(request, env),
};
