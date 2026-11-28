import { REMOTE_ACCESS_COOKIE_MAX, REMOTE_SPARK_COOKIE_MAX } from '@spark-outpost/contracts';
import { remoteSparkAccessSecret, remoteSparkSecret, type SecretStore } from '../setup/secrets.ts';

export async function savedSparkCookie(secrets: SecretStore, id: string): Promise<string | null> {
  try {
    const value = await secrets.get(remoteSparkSecret(id));
    return value && value.length <= REMOTE_SPARK_COOKIE_MAX ? value : null;
  } catch {
    return null;
  }
}

export function saveSparkCookie(secrets: SecretStore, id: string, value: string): Promise<void> {
  return secrets.set(remoteSparkSecret(id), value);
}

export function forgetSparkCookie(secrets: SecretStore, id: string): Promise<void> {
  return secrets.delete(remoteSparkSecret(id));
}

export async function savedSparkAccess(secrets: SecretStore, id: string): Promise<string | null> {
  try {
    const value = await secrets.get(remoteSparkAccessSecret(id));
    return value && value.length <= REMOTE_ACCESS_COOKIE_MAX ? value : null;
  } catch {
    return null;
  }
}

export async function saveSparkAccess(
  secrets: SecretStore,
  id: string,
  value: string | null,
): Promise<void> {
  if (value === null) await secrets.delete(remoteSparkAccessSecret(id));
  else await secrets.set(remoteSparkAccessSecret(id), value);
}
