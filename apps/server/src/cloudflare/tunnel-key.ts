import { z } from 'zod';

const keySchema = z.object({ tunnel: z.string().min(1), token: z.string().min(1) });
const keysSchema = z.array(keySchema).max(2);
export type TunnelKey = z.infer<typeof keySchema>;

export const packTunnelKeys = (keys: TunnelKey[]): string => JSON.stringify(keys);

export function unpackTunnelKeys(stored: string | null): TunnelKey[] {
  if (!stored) return [];
  try {
    const parsed = keysSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
