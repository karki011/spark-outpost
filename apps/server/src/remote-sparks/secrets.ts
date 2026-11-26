import { REMOTE_SPARK_COOKIE_MAX } from '@spark-outpost/contracts';
import { remoteSparkSecret, type SecretStore } from '../setup/secrets.ts';

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
