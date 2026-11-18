export interface ParsedUrl {
  href: string;
  protocol: string;
  hostname: string;
  host: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  origin: string;
  username: string;
  password: string;
  searchParams: { get(name: string): string | null };
  toString(): string;
}

const UrlParser = (globalThis as unknown as { URL: new (value: string) => ParsedUrl }).URL;

export function parseUrl(value: string): ParsedUrl | null {
  try {
    return new UrlParser(value);
  } catch {
    return null;
  }
}
