import { PUSH_CONTACT_DEFAULT, PUSH_CONTACT_MAX } from '@spark-outpost/contracts';

const NOT_PUBLIC_SUFFIXES = [
  'invalid',
  'local',
  'localhost',
  'localdomain',
  'test',
  'example',
  'internal',
  'lan',
  'home',
  'corp',
  'onion',
  'arpa',
];
const TAILNET_SUFFIXES = ['ts.net', 'tailscale.net'];

function endsWithAny(name: string, suffixes: readonly string[]): boolean {
  return suffixes.some((end) => name === end || name.endsWith(`.${end}`));
}

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TOP_LEVEL = /^[a-z]{2,63}$/;
const MAILBOX = /^mailto:([A-Za-z0-9.!#$%&'*+/=^_`{|}~-]{1,64})@([A-Za-z0-9.-]{1,253})$/;

export const CONTACT_FORMAT =
  'Enter an email address or an https:// address, such as you@example.org.';
export const CONTACT_NOT_PUBLIC =
  'Use an address on a public domain. Apple refuses local, test and .invalid names.';
export const CONTACT_TAILNET =
  'Do not use your tailnet name: the contact is sent to Apple and Google with every notification.';

export function normalizePushContact(raw: string): string {
  const value = raw.trim();
  if (/^[^:/\s]+@[^\s]+$/.test(value)) return `mailto:${value}`;
  return value;
}

function hostProblem(host: string, serveHostname: string | null): string | null {
  const name = host.toLowerCase().replace(/\.$/, '');
  const labels = name.split('.');
  if (labels.length < 2 || !labels.every((label) => HOST_LABEL.test(label))) {
    return CONTACT_NOT_PUBLIC;
  }
  if (!TOP_LEVEL.test(labels.at(-1)!)) return CONTACT_NOT_PUBLIC;
  if (serveHostname && name === serveHostname.toLowerCase()) return CONTACT_TAILNET;
  if (endsWithAny(name, TAILNET_SUFFIXES)) return CONTACT_TAILNET;
  return endsWithAny(name, NOT_PUBLIC_SUFFIXES) ? CONTACT_NOT_PUBLIC : null;
}

function httpsProblem(contact: string, serveHostname: string | null): string | null {
  let url: URL;
  try {
    url = new URL(contact);
  } catch {
    return CONTACT_FORMAT;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return CONTACT_FORMAT;
  return hostProblem(url.hostname, serveHostname);
}

export function pushContactProblem(contact: string, serveHostname: string | null): string | null {
  if (contact.length === 0 || contact.length > PUSH_CONTACT_MAX) return CONTACT_FORMAT;
  if (contact.startsWith('mailto:')) {
    const mailbox = MAILBOX.exec(contact);
    return mailbox ? hostProblem(mailbox[2]!, serveHostname) : CONTACT_FORMAT;
  }
  if (contact.startsWith('https://')) return httpsProblem(contact, serveHostname);
  return CONTACT_FORMAT;
}

export function pushSubject(saved: string | null, serveHostname: string | null): string {
  if (saved === null || pushContactProblem(saved, serveHostname) !== null) {
    return PUSH_CONTACT_DEFAULT;
  }
  return saved;
}
