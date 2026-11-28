import { z } from 'zod';

const keySchema = z.object({ tunnel: z.string().min(1), token: z.string().min(1) });
export type TunnelKey = z.infer<typeof keySchema>;

export const packTunnelKey = (key: TunnelKey): string => JSON.stringify(key);

export function unpackTunnelKey(stored: string | null): TunnelKey | null {
  if (!stored) return null;
  try {
    const parsed = keySchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
