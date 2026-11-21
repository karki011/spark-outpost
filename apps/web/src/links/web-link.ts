const WEB_LINK = /^https?:\/\//i;

export function webLink(url: string): string | undefined {
  return WEB_LINK.test(url) ? url : undefined;
}
