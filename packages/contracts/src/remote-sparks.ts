import { z } from 'zod';
import { REMOTE_DEVICE_NAME_MAX, remoteHostnameSchema, type RemoteDeviceKind } from './remote.ts';
import { parseUrl } from './url.ts';

export const REMOTE_SPARK_NAME_MAX = 60;
export const REMOTE_SPARK_COOKIE_MAX = 512;
export const REMOTE_SPARK_PARTITION_PREFIX = 'spark-remote-';

export const remoteReachSchema = z.enum(['tailscale']);
export type RemoteReach = z.infer<typeof remoteReachSchema>;

export const REMOTE_REACH_LABELS: Record<RemoteReach, string> = {
  tailscale: 'Tailscale',
};

const REACH_SUFFIXES: Record<RemoteReach, readonly string[]> = {
  tailscale: ['.ts.net'],
};

export function reachOfHostname(hostname: string): RemoteReach | null {
  const host = hostname.toLowerCase();
  for (const reach of remoteReachSchema.options) {
    if (REACH_SUFFIXES[reach].some((suffix) => host.endsWith(suffix))) return reach;
  }
  return null;
}

export const REMOTE_DEVICE_KIND_LABELS: Record<RemoteDeviceKind, string> = {
  browser: 'Browser',
  spark: 'Spark Outpost',
};

const sparkName = z.string().trim().min(1).max(REMOTE_SPARK_NAME_MAX);
const pairingCode = z.string().regex(/^[0-9A-Za-z-]{1,40}$/);

export const remoteSparkSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  hostname: z.string(),
  reach: remoteReachSchema,
  paired: z.boolean(),
  createdAt: z.string(),
  lastOpenedAt: z.string().nullable(),
});
export type RemoteSpark = z.infer<typeof remoteSparkSchema>;

export const remoteSparkListSchema = z.object({
  available: z.boolean(),
  sparks: z.array(remoteSparkSchema),
});
export type RemoteSparkList = z.infer<typeof remoteSparkListSchema>;

export const addRemoteSparkRequestSchema = z.object({
  address: z.string().trim().min(1).max(400),
  name: sparkName,
});
export type AddRemoteSparkRequest = z.infer<typeof addRemoteSparkRequestSchema>;

export const renameRemoteSparkRequestSchema = z.object({ name: sparkName });
export type RenameRemoteSparkRequest = z.infer<typeof renameRemoteSparkRequestSchema>;

export const SPARK_ADDRESS_PROBLEMS = {
  empty: 'Paste the other Mac’s Remote control address or its pairing link.',
  scheme: 'The address must start with https://.',
  shape:
    'Use the address alone, like https://studio.example.ts.net, with no port, path or sign-in in it.',
  host: 'That is not an address Spark can reach. Use the address shown on the other Mac’s Remote control page.',
  reach: 'Spark can add another Mac through Tailscale only, so the address must end in .ts.net.',
  own: 'That is this Mac’s own address. Paste the address of the other Mac.',
} as const;
export type SparkAddressProblem = keyof typeof SPARK_ADDRESS_PROBLEMS;

export type ParsedSparkAddress =
  | { ok: true; hostname: string; reach: RemoteReach; code: string | null }
  | { ok: false; problem: SparkAddressProblem };

function refused(problem: SparkAddressProblem): ParsedSparkAddress {
  return { ok: false, problem };
}

export function fragmentValue(hash: string, key: string): string | null {
  for (const part of hash.replace(/^#/, '').split('&')) {
    const [name, ...rest] = part.split('=');
    if (name !== key) continue;
    try {
      return decodeURIComponent(rest.join('=').replace(/\+/g, ' '));
    } catch {
      return null;
    }
  }
  return null;
}

export function parseSparkAddress(input: string, ownHostname: string | null): ParsedSparkAddress {
  const text = input.trim();
  if (text === '') return refused('empty');
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  if (hasScheme && !/^https:\/\//i.test(text)) return refused('scheme');
  const url = parseUrl(hasScheme ? text : `https://${text}`);
  if (!url) return refused('shape');
  if (url.username !== '' || url.password !== '' || url.port !== '' || url.search !== '')
    return refused('shape');
  if (url.pathname !== '/' && url.pathname !== '') return refused('shape');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!remoteHostnameSchema.safeParse(hostname).success) return refused('host');
  const reach = reachOfHostname(hostname);
  if (!reach) return refused('reach');
  if (ownHostname !== null && hostname === ownHostname.toLowerCase()) return refused('own');
  const code = pairingCode.safeParse(fragmentValue(url.hash, 'code'));
  return { ok: true, hostname, reach, code: code.success ? code.data : null };
}

export function sparkPairingEntry(
  hostname: string,
  deviceName: string,
  code: string | null,
): string {
  const params = [
    ...(code ? [['code', code]] : []),
    ['name', deviceName.slice(0, REMOTE_DEVICE_NAME_MAX)],
    ['kind', 'spark' satisfies RemoteDeviceKind],
  ].map(([key, value]) => `${key}=${encodeURIComponent(value!)}`);
  return `https://${hostname}/#${params.join('&')}`;
}

export function remoteSparkOrigin(hostname: string): string {
  return `https://${hostname}`;
}

export function remoteSparkPartition(id: string): string {
  return `${REMOTE_SPARK_PARTITION_PREFIX}${id}`;
}

export function remoteSparkWindowTitle(name: string, hostname: string): string {
  return `Remote control · ${name} · ${hostname}`;
}

const cookieValue = z.string().min(1).max(REMOTE_SPARK_COOKIE_MAX);

export const remoteSparkBridgeToHostSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('remote-spark:open'),
    id: z.uuid(),
    name: sparkName,
    hostname: remoteHostnameSchema,
    deviceName: z.string().min(1).max(REMOTE_DEVICE_NAME_MAX),
    code: pairingCode.nullable(),
    cookie: cookieValue.nullable(),
  }),
  z.object({ kind: z.literal('remote-spark:close'), id: z.uuid() }),
]);
export type RemoteSparkBridgeToHost = z.infer<typeof remoteSparkBridgeToHostSchema>;

export const remoteSparkBridgeFromHostSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('remote-spark:cookie'),
    id: z.uuid(),
    hostname: remoteHostnameSchema,
    value: cookieValue,
  }),
  z.object({ kind: z.literal('remote-spark:signed-out'), id: z.uuid() }),
]);
export type RemoteSparkBridgeFromHost = z.infer<typeof remoteSparkBridgeFromHostSchema>;
