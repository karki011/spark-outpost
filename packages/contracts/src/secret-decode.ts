const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;
const PERCENT_BYTE = /%([0-9A-Fa-f]{2})/g;

function decodeBase64(value: string): string | null {
  if (value.length % 4 !== 0) return null;
  const digits = value.replace(/=+$/, '');
  let bits = 0;
  let width = 0;
  let decoded = '';
  for (const char of digits) {
    const digit = BASE64_ALPHABET.indexOf(char);
    if (digit === -1) return null;
    bits = ((bits << 6) | digit) & 0xffffff;
    width += 6;
    if (width >= 8) {
      width -= 8;
      decoded += String.fromCharCode((bits >> width) & 0xff);
    }
  }
  return decoded;
}

export function decodesToCredential(value: string): boolean {
  const decoded = decodeBase64(value);
  return decoded !== null && PRINTABLE_ASCII.test(decoded) && decoded.includes(':');
}

export function percentDecodedAscii(text: string): string {
  return text.replace(PERCENT_BYTE, (match, hex: string) => {
    const code = Number.parseInt(hex, 16);
    return code < 0x80 ? String.fromCharCode(code) : match;
  });
}
