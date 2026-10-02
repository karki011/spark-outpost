import { describe, expect, it } from 'vitest';
import { isSecretFileName } from './secret-files.ts';

describe('secret file names', () => {
  it('spots env files, keys and credentials but allows the example env file', () => {
    for (const name of [
      '.env',
      '.env.local',
      'id_rsa',
      'server.pem',
      'Credentials.json',
      'api-token',
    ]) {
      expect(isSecretFileName(name)).toBe(true);
    }
    for (const name of ['.env.example', 'notes.md', 'photo.png', 'keyboard.ts']) {
      expect(isSecretFileName(name)).toBe(false);
    }
  });
});
