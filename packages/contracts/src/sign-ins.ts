import { z } from 'zod';
import { addressToUrl, classifyBrowserUrl, parseBrowserUrl } from './browser.ts';

export const SIGN_IN_LABEL_MAX = 60;
export const SIGN_IN_ORIGIN_MAX = 300;
export const SIGN_IN_USERNAME_MIN = 3;
export const SIGN_IN_USERNAME_MAX = 200;
export const SIGN_IN_PASSWORD_MIN = 4;
export const SIGN_IN_PASSWORD_MAX = 500;
export const SIGN_INS_PER_PROJECT_MAX = 20;
export const SIGN_IN_SITES_MAX = 8;

export const SIGN_INS_NEED_APP = 'Saved sign-ins are available in the Spark Outpost Mac app.';

function allowedOrigin(address: string): string | null {
  const kind = classifyBrowserUrl(address);
  const url = parseBrowserUrl(address);
  if (!url) return null;
  if (kind === 'local') return url.origin;
  return kind === 'external' && url.protocol === 'https:' ? url.origin : null;
}

export function signInOriginOf(typed: string): string | null {
  const address = addressToUrl(typed);
  return address === null ? null : allowedOrigin(address);
}

export function signInSites(saved: { origin: string; sites: readonly string[] }): string[] {
  return [...new Set([saved.origin, ...saved.sites])];
}

function listed(sites: readonly string[]): string {
  if (sites.length === 1) return sites[0]!;
  return `${sites.slice(0, -1).join(', ')} or ${sites.at(-1)}`;
}

export function signInOriginProblem(sites: readonly string[], pageUrl: string): string | null {
  if (sites.length === 0 || sites.some((site) => allowedOrigin(site) !== site)) {
    return 'The site saved for this sign-in is not valid. Edit it in Settings.';
  }
  const kind = classifyBrowserUrl(pageUrl);
  const page = parseBrowserUrl(pageUrl);
  if (!page || (kind !== 'local' && kind !== 'external')) {
    return 'The tab is not on a web page Spark can sign in to.';
  }
  if (kind === 'external' && page.protocol !== 'https:') {
    return 'Spark signs in only on https pages and local development hosts.';
  }
  if (!sites.includes(page.origin)) {
    return `This sign-in types only on ${listed(sites)}, and the tab is on ${page.origin}. If ${page.origin} is where this sign-in belongs, ask the user to add it in Settings, Projects, Saved sign-ins (Add this site).`;
  }
  return null;
}

export function maskUsername(username: string): string {
  const at = username.lastIndexOf('@');
  const name = at > 0 ? username.slice(0, at) : username;
  const domain = at > 0 ? username.slice(at) : '';
  return `${[...name][0] ?? ''}•••${domain}`;
}

const label = z.string().trim().min(1).max(SIGN_IN_LABEL_MAX);
const origin = z.string().trim().min(1).max(SIGN_IN_ORIGIN_MAX);
const username = z.string().min(SIGN_IN_USERNAME_MIN).max(SIGN_IN_USERNAME_MAX);
const password = z.string().min(SIGN_IN_PASSWORD_MIN).max(SIGN_IN_PASSWORD_MAX);
const sites = z.array(origin).max(SIGN_IN_SITES_MAX);

export const savedSignInSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  label,
  origin,
  sites: z.array(z.string()).default([]),
  refusedSite: z.string().nullable().default(null),
  username: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SavedSignIn = z.infer<typeof savedSignInSchema>;

export const signInListSchema = z.object({ signIns: z.array(savedSignInSchema) });
export type SignInList = z.infer<typeof signInListSchema>;

export const createSignInRequestSchema = z.object({
  label,
  origin,
  sites: sites.optional(),
  username,
  password,
});
export type CreateSignInRequest = z.infer<typeof createSignInRequestSchema>;

export const updateSignInRequestSchema = z.object({
  label,
  origin,
  sites: sites.optional(),
  username: username.optional(),
  password: password.optional(),
});
export type UpdateSignInRequest = z.infer<typeof updateSignInRequestSchema>;
