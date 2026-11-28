import { z } from 'zod';
import { cloudflareCall, type CloudflareAccountApi } from './account-api.ts';

const id = z.string().min(1).max(64);
const account = (accountId: string) => `/accounts/${encodeURIComponent(accountId)}`;
const zone = (zoneId: string) => `/zones/${encodeURIComponent(zoneId)}`;

const ZONES_PER_PAGE = 50;
const ZONE_PAGES_MAX = 40;
const zonesSchema = z.array(z.object({ id, name: z.string().min(1).max(253) }));
export interface CloudflareZone {
  id: string;
  name: string;
}

export async function listZones(
  api: CloudflareAccountApi,
  accountId: string,
): Promise<CloudflareZone[]> {
  const zones: CloudflareZone[] = [];
  for (let page = 1; page <= ZONE_PAGES_MAX; page += 1) {
    const query = new URLSearchParams({
      'account.id': accountId,
      per_page: String(ZONES_PER_PAGE),
      page: String(page),
    });
    const found = zonesSchema.safeParse(await cloudflareCall(api, 'GET', `/zones?${query}`));
    if (!found.success) break;
    zones.push(...found.data);
    if (found.data.length < ZONES_PER_PAGE) break;
  }
  return zones;
}

const tunnelsSchema = z.array(z.object({ id }));

export async function tunnelNamed(
  api: CloudflareAccountApi,
  accountId: string,
  name: string,
): Promise<string | null> {
  const query = new URLSearchParams({ name, is_deleted: 'false' });
  const found = tunnelsSchema.safeParse(
    await cloudflareCall(api, 'GET', `${account(accountId)}/cfd_tunnel?${query}`),
  );
  return found.success ? (found.data[0]?.id ?? null) : null;
}

export async function createTunnel(
  api: CloudflareAccountApi,
  accountId: string,
  name: string,
  secret: string,
): Promise<string> {
  const created = z.object({ id }).parse(
    await cloudflareCall(api, 'POST', `${account(accountId)}/cfd_tunnel`, {
      json: { name, config_src: 'cloudflare', tunnel_secret: secret },
    }),
  );
  return created.id;
}

export async function tunnelToken(
  api: CloudflareAccountApi,
  accountId: string,
  tunnelId: string,
): Promise<string> {
  return z
    .string()
    .min(20)
    .max(4096)
    .parse(
      await cloudflareCall(
        api,
        'GET',
        `${account(accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/token`,
      ),
    );
}

export async function pointTunnel(
  api: CloudflareAccountApi,
  accountId: string,
  tunnelId: string,
  route: { hostname: string; service: string },
): Promise<void> {
  await cloudflareCall(
    api,
    'PUT',
    `${account(accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/configurations`,
    { json: { config: { ingress: [route, { service: 'http_status:404' }] } } },
  );
}

const recordsSchema = z.array(z.object({ type: z.string(), content: z.string() }));
export interface DnsRecord {
  type: string;
  content: string;
}

export async function dnsRecordsNamed(
  api: CloudflareAccountApi,
  zoneId: string,
  hostname: string,
): Promise<DnsRecord[]> {
  const query = new URLSearchParams({ name: hostname });
  const found = recordsSchema.safeParse(
    await cloudflareCall(api, 'GET', `${zone(zoneId)}/dns_records?${query}`),
  );
  return found.success ? found.data : [];
}

export async function createCname(
  api: CloudflareAccountApi,
  zoneId: string,
  hostname: string,
  target: string,
): Promise<void> {
  await cloudflareCall(api, 'POST', `${zone(zoneId)}/dns_records`, {
    json: { type: 'CNAME', name: hostname, content: target, proxied: true },
  });
}

const appsSchema = z.array(z.object({ id, domain: z.string().optional() }));

export async function accessAppId(
  api: CloudflareAccountApi,
  zoneId: string,
  hostname: string,
): Promise<string | null> {
  const apps = appsSchema.safeParse(
    await cloudflareCall(api, 'GET', `${zone(zoneId)}/access/apps?per_page=100`),
  );
  if (!apps.success) return null;
  return apps.data.find((app) => app.domain === hostname)?.id ?? null;
}

export async function createAccessApp(
  api: CloudflareAccountApi,
  zoneId: string,
  app: { name: string; hostname: string },
): Promise<string> {
  const created = z.object({ id }).parse(
    await cloudflareCall(api, 'POST', `${zone(zoneId)}/access/apps`, {
      json: {
        name: app.name,
        domain: app.hostname,
        type: 'self_hosted',
        session_duration: '720h',
      },
    }),
  );
  return created.id;
}

const policies = (zoneId: string, appId: string) =>
  `${zone(zoneId)}/access/apps/${encodeURIComponent(appId)}/policies`;

const policiesSchema = z.array(
  z.object({
    decision: z.string(),
    include: z.array(z.object({ email: z.object({ email: z.string() }).optional() })).optional(),
  }),
);
export type AccessPolicy = z.infer<typeof policiesSchema>[number];

export async function accessPolicies(
  api: CloudflareAccountApi,
  zoneId: string,
  appId: string,
): Promise<AccessPolicy[]> {
  return policiesSchema.parse(await cloudflareCall(api, 'GET', policies(zoneId, appId)));
}

export function letsInOnly(found: AccessPolicy[], email: string): boolean {
  const wanted = email.toLowerCase();
  const allows = (policy: AccessPolicy) =>
    policy.decision === 'allow' &&
    (policy.include ?? []).some((rule) => rule.email?.email.toLowerCase() === wanted);
  return found.some(allows) && found.every((policy) => policy.decision !== 'bypass');
}

export async function allowEmail(
  api: CloudflareAccountApi,
  zoneId: string,
  appId: string,
  email: string,
): Promise<void> {
  await cloudflareCall(api, 'POST', policies(zoneId, appId), {
    json: { name: 'Owner', decision: 'allow', include: [{ email: { email } }] },
  });
}
