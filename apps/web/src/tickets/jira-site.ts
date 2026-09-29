const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const HTTPS = 'https://';

export function jiraSiteUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const withScheme = HAS_SCHEME.test(trimmed) ? trimmed : `${HTTPS}${trimmed}`;
  try {
    const url = new URL(withScheme);
    return `${url.protocol}//${url.host}`;
  } catch {
    return trimmed;
  }
}

export function jiraSiteHost(input: string): string {
  const url = jiraSiteUrl(input);
  return url.startsWith(HTTPS) ? url.slice(HTTPS.length) : url;
}
