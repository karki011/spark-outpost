import type { CloudflareReachPermission } from '@spark-outpost/contracts';
import { CloudflareApiError } from './account-api.ts';
import { SETUP_UNREACHABLE, StepFailure } from './setup-problems.ts';

export const REACH_SCOPES: Record<CloudflareReachPermission, string> = {
  account: 'account-settings.read',
  domains: 'zone.read',
  dns: 'dns.write',
  tunnel: 'argotunnel.write',
  access: 'zone-access.write',
};

export const ZERO_TRUST_URL = 'https://one.dash.cloudflare.com/';

export const REACH_UNAVAILABLE = 'This build can’t set up a Cloudflare address for you.';
export const REACH_NO_TUNNEL_PROGRAM =
  'This build is missing Cloudflare’s tunnel program. Use Custom domain and run your own tunnel.';
export const REACH_BUSY = 'A set-up is already running.';
export const REACH_NOT_CONNECTED =
  'The tunnel didn’t connect. Check this computer’s internet connection and try again.';
export const REACH_TOKEN_NOT_SAVED =
  'Spark couldn’t save the tunnel’s key in your keychain. Try again.';
export const REACH_RECORD_TAKEN =
  'That address already has a DNS record that isn’t Spark’s. Remove it in Cloudflare, or start over with another address.';

export const reachNoDomain = (hostname: string) =>
  `This Cloudflare account has no domain for ${hostname}. Start over with an address on one of its domains.`;

const NOT_ALLOWED: Record<CloudflareReachPermission, string> = {
  account: 'Cloudflare didn’t give Spark permission to see which account this is. Allow it again.',
  domains: 'Cloudflare didn’t give Spark permission to see your domains. Allow it and try again.',
  dns: 'Cloudflare didn’t give Spark permission to add a DNS record. Allow it and try again.',
  tunnel: 'Cloudflare didn’t give Spark permission to create a tunnel. Allow it and try again.',
  access: 'Cloudflare didn’t give Spark permission to add a sign-in page. Allow it and try again.',
};

export const reachNotAllowed = (permission: CloudflareReachPermission) =>
  new StepFailure(NOT_ALLOWED[permission], 'allow');

export function reachFailure(error: unknown, permission: CloudflareReachPermission): StepFailure {
  if (error instanceof StepFailure) return error;
  if (!(error instanceof CloudflareApiError)) {
    return new StepFailure('Something went wrong on this computer. Try again.', 'retry');
  }
  if (error.kind === 'unreachable') return new StepFailure(SETUP_UNREACHABLE, 'retry');
  if (error.kind === 'permission') return reachNotAllowed(permission);
  if (permission === 'access') {
    return new StepFailure(
      `Cloudflare couldn’t add the sign-in page: ${error.message}. Open Zero Trust in Cloudflare once to set it up, then check again.`,
      'cloudflare',
      ZERO_TRUST_URL,
    );
  }
  return new StepFailure(`Cloudflare refused: ${error.message}`, 'retry');
}
