import { isLocalHost, parseBrowserUrl } from '@spark-outpost/contracts';

export const WEB_ADDRESS_SCHEME_REASON =
  "An agent's own web tools open only http(s) and ws(s) addresses";
export const WEB_ADDRESS_LOGIN_REASON = 'Addresses with a login in them are refused';
export const WEB_ADDRESS_LOCAL_REASON =
  "An agent's own web tools don't reach this computer; use the Browser pane for local pages";

const WEB_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:']);
const LOOPBACK_V4 = /^127(?:\.\d{1,3}){3}$/;
const MAPPED_LOOPBACK_V6 = /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/;
const UNSPECIFIED = new Set(['0.0.0.0', '[::]', '[::1]']);

function onThisComputer(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return (
    host === '' ||
    isLocalHost(host) ||
    LOOPBACK_V4.test(host) ||
    MAPPED_LOOPBACK_V6.test(host) ||
    UNSPECIFIED.has(host)
  );
}

export function webAddressRefusal(address: string): string | null {
  const url = parseBrowserUrl(address.trim());
  if (!url || !WEB_SCHEMES.has(url.protocol)) return WEB_ADDRESS_SCHEME_REASON;
  if (url.username !== '' || url.password !== '') return WEB_ADDRESS_LOGIN_REASON;
  return onThisComputer(url.hostname) ? WEB_ADDRESS_LOCAL_REASON : null;
}
