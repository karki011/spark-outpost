type Env = Record<string, string | undefined>;

export interface R2Target {
  bucket: string;
  prefix: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  label: string;
}

export type TargetResult = { ok: true; target: R2Target } | { ok: false; missing: string[] };

const REMOTE = 'SPARKR2';

function value(env: Env, name: string): string {
  return (env[name] ?? '').trim();
}

export function r2Target(env: Env): TargetResult {
  const account = value(env, 'R2_ACCOUNT_ID');
  const endpoint =
    value(env, 'R2_ENDPOINT') || (account ? `https://${account}.r2.cloudflarestorage.com` : '');
  const needed: [string, string][] = [
    ['R2_ACCESS_KEY_ID', value(env, 'R2_ACCESS_KEY_ID')],
    ['R2_SECRET_ACCESS_KEY', value(env, 'R2_SECRET_ACCESS_KEY')],
    ['R2_BUCKET', value(env, 'R2_BUCKET')],
    ['R2_ACCOUNT_ID (or R2_ENDPOINT)', endpoint],
  ];
  const missing = needed.filter(([, found]) => !found).map(([name]) => `${name} is not set.`);
  if (missing.length > 0) return { ok: false, missing };
  const bucket = value(env, 'R2_BUCKET');
  const prefix = value(env, 'R2_PREFIX').replace(/^\/+|\/+$/g, '');
  return {
    ok: true,
    target: {
      bucket,
      prefix,
      endpoint,
      accessKeyId: value(env, 'R2_ACCESS_KEY_ID'),
      secretAccessKey: value(env, 'R2_SECRET_ACCESS_KEY'),
      label: `r2:${bucket}${prefix ? `/${prefix}` : ''}`,
    },
  };
}

export function rcloneRemote(target: R2Target, name: string): string {
  const folder = [target.bucket, target.prefix, name].filter(Boolean).join('/');
  return `${REMOTE.toLowerCase()}:${folder}`;
}

export function rcloneEnv(target: R2Target): Record<string, string> {
  const key = (name: string) => `RCLONE_CONFIG_${REMOTE}_${name}`;
  return {
    [key('TYPE')]: 's3',
    [key('PROVIDER')]: 'Cloudflare',
    [key('ACCESS_KEY_ID')]: target.accessKeyId,
    [key('SECRET_ACCESS_KEY')]: target.secretAccessKey,
    [key('ENDPOINT')]: target.endpoint,
    [key('NO_CHECK_BUCKET')]: 'true',
    [key('ACL')]: 'private',
  };
}
