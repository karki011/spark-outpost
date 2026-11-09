import { BROWSER_URL_MAX, isLocalHost, parseBrowserUrl } from '@spark-outpost/contracts';

export const WEB_ADDRESS_SCHEME_REASON =
  "An agent's own web tools open only http(s) and ws(s) addresses";
export const WEB_ADDRESS_LOGIN_REASON = 'Addresses with a login in them are refused';
export const WEB_ADDRESS_LOCAL_REASON =
  "An agent's own web tools don't reach this computer; use the Browser pane for local pages";

export const OPEN_ADDRESS_SCHEME_REASON = 'Spark opens only http(s) addresses in your browser';
export const OPEN_ADDRESS_LOCAL_REASON =
  'Spark does not open addresses on this computer for agents';
export const OPEN_ADDRESS_LONG_REASON = 'The address is too long to show';

const WEB_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:']);
const OPEN_SCHEMES = new Set(['http:', 'https:']);
const LOOPBACK_V4 = /^127(?:\.\d{1,3}){3}$/;
const MAPPED_LOOPBACK_V6 = /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/;
const UNSPECIFIED = new Set(['0.0.0.0', '[::]', '[::1]']);

type AddressFault = 'scheme' | 'login' | 'local';

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

function addressFault(address: string, schemes: ReadonlySet<string>): AddressFault | null {
  const url = parseBrowserUrl(address.trim());
  if (!url || !schemes.has(url.protocol)) return 'scheme';
  if (url.username !== '' || url.password !== '') return 'login';
  return onThisComputer(url.hostname) ? 'local' : null;
}

export function webAddressRefusal(address: string): string | null {
  switch (addressFault(address, WEB_SCHEMES)) {
    case 'scheme':
      return WEB_ADDRESS_SCHEME_REASON;
    case 'login':
      return WEB_ADDRESS_LOGIN_REASON;
    case 'local':
      return WEB_ADDRESS_LOCAL_REASON;
    case null:
      return null;
  }
}

export function openAddressRefusal(address: string): string | null {
  if (address.trim().length > BROWSER_URL_MAX) return OPEN_ADDRESS_LONG_REASON;
  switch (addressFault(address, OPEN_SCHEMES)) {
    case 'scheme':
      return OPEN_ADDRESS_SCHEME_REASON;
    case 'login':
      return WEB_ADDRESS_LOGIN_REASON;
    case 'local':
      return OPEN_ADDRESS_LOCAL_REASON;
    case null:
      return null;
  }
}
