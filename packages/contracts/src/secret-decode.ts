const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;

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

export interface PercentDecoded {
  decoded: string;
  rawStart: number[];
}

const HEX_PAIR = /^[0-9A-Fa-f]{2}$/;

function asciiByteAt(text: string, index: number): string | null {
  if (text[index] !== '%') return null;
  const hex = text.slice(index + 1, index + 3);
  if (!HEX_PAIR.test(hex)) return null;
  const code = Number.parseInt(hex, 16);
  return code < 0x80 ? String.fromCharCode(code) : null;
}

export function percentDecodedAscii(text: string): PercentDecoded {
  let decoded = '';
  const rawStart: number[] = [];
  let index = 0;
  while (index < text.length) {
    rawStart.push(index);
    const byte = asciiByteAt(text, index);
    decoded += byte ?? text[index];
    index += byte === null ? 1 : 3;
  }
  rawStart.push(text.length);
  return { decoded, rawStart };
}
