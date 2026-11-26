import { REMOTE_SPARK_ICON_MAX_BYTES, setSparkIconRequestSchema } from '@spark-outpost/contracts';

export const ICON_REFUSED = 'That image could not be used. Pick a PNG, JPEG, WebP or GIF.';
const ICON_SIDE_MIN = 16;
const ICON_SIDE_MAX = 256;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_LENGTH = 13;
const IHDR_END = 24;

function sideAllowed(side: number): boolean {
  return side >= ICON_SIDE_MIN && side <= ICON_SIDE_MAX;
}

export function isSparkIconPng(bytes: Buffer): boolean {
  if (bytes.length < IHDR_END || bytes.length > REMOTE_SPARK_ICON_MAX_BYTES) return false;
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return false;
  if (bytes.readUInt32BE(8) !== IHDR_LENGTH) return false;
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return false;
  return sideAllowed(bytes.readUInt32BE(16)) && sideAllowed(bytes.readUInt32BE(20));
}

export function sparkIconFrom(body: unknown): Buffer | null {
  const parsed = setSparkIconRequestSchema.safeParse(body);
  if (!parsed.success) return null;
  const bytes = Buffer.from(parsed.data.png, 'base64');
  return isSparkIconPng(bytes) ? bytes : null;
}
