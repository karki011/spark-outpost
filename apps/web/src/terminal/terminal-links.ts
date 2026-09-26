export type OpenWindow = (url: string, target: string, features: string) => unknown;

export function openTerminalLink(
  event: Pick<MouseEvent, 'preventDefault'>,
  uri: string,
  open: OpenWindow = (url, target, features) => window.open(url, target, features),
): boolean {
  event.preventDefault();
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  open(url.href, '_blank', 'noopener,noreferrer');
  return true;
}
