import { openOutside } from '../../browser/outside-link.ts';

export interface AddressParts {
  before: string;
  host: string;
  after: string;
}

export function addressParts(url: string, host: string): AddressParts {
  const at = host ? url.toLowerCase().indexOf(host.toLowerCase()) : -1;
  if (at < 0) return { before: url, host: '', after: '' };
  return { before: url.slice(0, at), host, after: url.slice(at + host.length) };
}

export function addressByline(agent: string, secretFiles: readonly string[] | undefined): string {
  if (secretFiles && secretFiles.length > 0) {
    return `${agent} wants you to open an address that holds a value from ${secretFiles.join(', ')}.`;
  }
  return `${agent} wants you to open an address in your browser.`;
}

export const ADDRESS_NOTE =
  'Open shows it in your default browser, not the Browser pane. What the site asks for goes to that site; the agent never sees it.';

export const ADDRESS_ON_THE_MAC = 'Waiting for you on your Mac. Addresses open there.';

export function openInBrowser(url: string): void {
  openOutside(url);
}
