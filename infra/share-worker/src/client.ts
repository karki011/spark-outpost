const UNKNOWN = 'unknown';
const MAX_ADDRESS_CHARS = 64;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HEXTET = /^[0-9a-f]{1,4}$/;

function ipv4Bytes(text: string): number[] | null {
  const match = IPV4.exec(text);
  if (!match) return null;
  const bytes = match.slice(1).map(Number);
  return bytes.every((byte) => byte <= 255) ? bytes : null;
}

function withHexTail(text: string): string | null {
  const split = text.lastIndexOf(':');
  const tail = text.slice(split + 1);
  if (!tail.includes('.')) return text;
  const bytes = ipv4Bytes(tail);
  if (!bytes) return null;
  const high = ((bytes[0]! << 8) | bytes[1]!).toString(16);
  const low = ((bytes[2]! << 8) | bytes[3]!).toString(16);
  return `${text.slice(0, split + 1)}${high}:${low}`;
}

function groupsOf(part: string): number[] | null {
  if (part === '') return [];
  const groups = part.split(':');
  if (!groups.every((group) => HEXTET.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

function hextets(text: string): number[] | null {
  const source = withHexTail(text);
  if (source === null) return null;
  const halves = source.split('::');
  if (halves.length > 2) return null;
  const head = groupsOf(halves[0]!);
  const tail = halves.length === 2 ? groupsOf(halves[1]!) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function mappedIpv4(groups: number[]): string | null {
  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (!mapped) return null;
  const [high, low] = [groups[6]!, groups[7]!];
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

export function clientKeyFor(address: string | null): string {
  const text = (address ?? '').trim().toLowerCase();
  if (text === '' || text.length > MAX_ADDRESS_CHARS) return UNKNOWN;
  const plain = ipv4Bytes(text);
  if (plain) return plain.join('.');
  const groups = hextets(text.split('%')[0]!);
  if (!groups) return UNKNOWN;
  const network = groups.slice(0, 4).map((group) => group.toString(16));
  return mappedIpv4(groups) ?? `${network.join(':')}::/64`;
}

export function clientKey(request: Request): string {
  return clientKeyFor(request.headers.get('cf-connecting-ip'));
}
