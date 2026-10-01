import { describe, expect, it } from 'vitest';
import { r2Target, rcloneEnv, rcloneRemote } from './release-target.ts';

const SECRET = 'r2-secret-value-0123456789abcdef';
const ENV = {
  R2_ACCOUNT_ID: 'acct123',
  R2_ACCESS_KEY_ID: 'key-id',
  R2_SECRET_ACCESS_KEY: SECRET,
  R2_BUCKET: 'spark-releases',
  R2_PREFIX: '/mac/',
};

describe('r2Target', () => {
  it('lists every missing variable by name only', () => {
    expect(r2Target({ R2_SECRET_ACCESS_KEY: SECRET })).toEqual({
      ok: false,
      missing: [
        'R2_ACCESS_KEY_ID is not set.',
        'R2_BUCKET is not set.',
        'R2_ACCOUNT_ID (or R2_ENDPOINT) is not set.',
      ],
    });
  });

  it('builds the R2 endpoint and a label that holds no credentials', () => {
    const result = r2Target(ENV);
    if (!result.ok) throw new Error('expected a target');
    expect(result.target.endpoint).toBe('https://acct123.r2.cloudflarestorage.com');
    expect(result.target.label).toBe('r2:spark-releases/mac');
    expect(result.target.label).not.toContain(SECRET);
    expect(rcloneRemote(result.target, 'beta-mac.yml')).toBe(
      'sparkr2:spark-releases/mac/beta-mac.yml',
    );
  });

  it('passes credentials to rclone through its environment, never its arguments', () => {
    const result = r2Target({ ...ENV, R2_PREFIX: '', R2_ENDPOINT: 'https://s3.example.com' });
    if (!result.ok) throw new Error('expected a target');
    expect(rcloneRemote(result.target, '')).toBe('sparkr2:spark-releases');
    expect(rcloneEnv(result.target)).toMatchObject({
      RCLONE_CONFIG_SPARKR2_TYPE: 's3',
      RCLONE_CONFIG_SPARKR2_PROVIDER: 'Cloudflare',
      RCLONE_CONFIG_SPARKR2_SECRET_ACCESS_KEY: SECRET,
      RCLONE_CONFIG_SPARKR2_ENDPOINT: 'https://s3.example.com',
    });
  });
});
