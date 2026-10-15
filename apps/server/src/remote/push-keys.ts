import { z } from 'zod';
import { PUSH_KEYS_SECRET, type SecretStore } from '../setup/secrets.ts';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

const vapidKeysSchema = z.object({ publicKey: z.string().min(1), privateKey: z.string().min(1) });

export interface PushKeys {
  get(): Promise<VapidKeys>;
}

function savedKeys(raw: string | null): VapidKeys | null {
  if (raw === null) return null;
  try {
    const parsed = vapidKeysSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function pushKeys(secrets: SecretStore, generate: () => VapidKeys): PushKeys {
  let loading: Promise<VapidKeys> | null = null;

  const load = async (): Promise<VapidKeys> => {
    const saved = savedKeys(await secrets.get(PUSH_KEYS_SECRET));
    if (saved) return saved;
    const created = generate();
    await secrets.set(PUSH_KEYS_SECRET, JSON.stringify(created));
    return created;
  };

  return {
    get() {
      loading ??= load().catch((error: unknown) => {
        loading = null;
        throw error;
      });
      return loading;
    },
  };
}
