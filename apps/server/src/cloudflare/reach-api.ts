import { z } from 'zod';
import { cloudflareCall, type CloudflareAccountApi } from './account-api.ts';
import { StepFailure } from './setup-problems.ts';

const id = z.string().min(1).max(64);
const account = (accountId: string) => `/accounts/${encodeURIComponent(accountId)}`;
const zone = (zoneId: string) => `/zones/${encodeURIComponent(zoneId)}`;

const ZONES_PER_PAGE = 50;
const ZONE_PAGES_MAX = 40;
export const REACH_DOMAINS_UNREADABLE =
  'Cloudflare sent a list of domains Spark couldn’t read. Try again.';
export const REACH_TOO_MANY_DOMAINS =
  'This Cloudflare account has more domains than Spark can look through. Use Custom domain and run your own tunnel.';
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
    if (!found.success) throw new StepFailure(REACH_DOMAINS_UNREADABLE, 'retry');
    zones.push(...found.data);
    if (found.data.length < ZONES_PER_PAGE) return zones;
  }
  throw new StepFailure(REACH_TOO_MANY_DOMAINS, null);
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

const appsSchema = z.array(
  z.object({
    id,
    domain: z.string().optional(),
    destinations: z.array(z.object({ overrides: z.array(z.unknown()).optional() })).optional(),
  }),
);

export interface AccessApp {
  id: string;
  exemptsPaths: boolean;
}

export async function accessAppFor(
  api: CloudflareAccountApi,
  zoneId: string,
  hostname: string,
): Promise<AccessApp | null> {
  const apps = appsSchema.safeParse(
    await cloudflareCall(api, 'GET', `${zone(zoneId)}/access/apps?per_page=100`),
  );
  if (!apps.success) return null;
  const app = apps.data.find((candidate) => candidate.domain === hostname);
  if (!app) return null;
  const exemptsPaths = (app.destinations ?? []).some(
    (destination) => (destination.overrides ?? []).length > 0,
  );
  return { id: app.id, exemptsPaths };
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

const rules = z.array(z.record(z.string(), z.unknown())).optional();
const policiesSchema = z.array(
  z.object({ decision: z.string(), include: rules, require: rules, exclude: rules }),
);
export type AccessPolicy = z.infer<typeof policiesSchema>[number];

export async function accessPolicies(
  api: CloudflareAccountApi,
  zoneId: string,
  appId: string,
): Promise<AccessPolicy[]> {
  const path = `${policies(zoneId, appId)}?per_page=${ACCESS_POLICY_PAGE}`;
  return policiesSchema.parse(await cloudflareCall(api, 'GET', path));
}

export const ACCESS_POLICY_PAGE = 50;

const emailRule = z.strictObject({ email: z.strictObject({ email: z.string() }) });

function allowsOnly(policy: AccessPolicy, email: string): boolean {
  if (policy.decision !== 'allow') return false;
  if ((policy.require ?? []).length > 0 || (policy.exclude ?? []).length > 0) return false;
  const include = policy.include ?? [];
  const rule = include.length === 1 ? emailRule.safeParse(include[0]) : null;
  return rule?.success === true && rule.data.email.email.toLowerCase() === email.toLowerCase();
}

export function letsInOnly(found: AccessPolicy[], email: string): boolean {
  return found.length > 0 && found.every((policy) => allowsOnly(policy, email));
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
