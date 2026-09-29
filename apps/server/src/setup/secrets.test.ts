import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.ts';
import { configuredSecretStore } from './secrets.ts';

describe('configuredSecretStore', () => {
  it('seeds the memory store from MEMORY_SECRETS for every process', async () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://u:p@h/db',
      SECRET_STORE: 'memory',
      MEMORY_SECRETS: JSON.stringify({ claude: 'sk-test' }),
    });
    const secrets = configuredSecretStore(config);
    expect(await secrets.get('claude')).toBe('sk-test');
    expect(await secrets.get('codex')).toBeNull();
  });
});
