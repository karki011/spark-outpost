import { z } from 'zod';
import { cloudflareCall, type CloudflareAccountApi } from './account-api.ts';

const id = z.string().min(1).max(64);
const account = (accountId: string) => `/accounts/${encodeURIComponent(accountId)}`;
const zone = (zoneId: string) => `/zones/${encodeURIComponent(zoneId)}`;

const zonesSchema = z.array(z.object({ id, name: z.string().min(1).max(253) }));
export interface CloudflareZone {
  id: string;
  name: string;
}

export async function listZones(
  api: CloudflareAccountApi,
  accountId: string,
): Promise<CloudflareZone[]> {
  const query = new URLSearchParams({ 'account.id': accountId, per_page: '50' });
  const zones = zonesSchema.safeParse(await cloudflareCall(api, 'GET', `/zones?${query}`));
  return zones.success ? zones.data : [];
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

const appsSchema = z.array(z.object({ domain: z.string().optional() }));

export async function accessAppExists(
  api: CloudflareAccountApi,
  zoneId: string,
  hostname: string,
): Promise<boolean> {
  const apps = appsSchema.safeParse(
    await cloudflareCall(api, 'GET', `${zone(zoneId)}/access/apps?per_page=100`),
  );
  return apps.success && apps.data.some((app) => app.domain === hostname);
}

export async function createAccessApp(
  api: CloudflareAccountApi,
  zoneId: string,
  app: { name: string; hostname: string; email: string },
): Promise<void> {
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
  await cloudflareCall(
    api,
    'POST',
    `${zone(zoneId)}/access/apps/${encodeURIComponent(created.id)}/policies`,
    {
      json: {
        name: 'Owner',
        decision: 'allow',
        include: [{ email: { email: app.email } }],
      },
    },
  );
}
