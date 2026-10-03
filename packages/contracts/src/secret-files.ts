export const SECRET_FILE_PATTERNS: readonly string[] = [
  '.env',
  '.env.*',
  'id_rsa',
  'id_rsa.pub',
  'id_ed25519',
  'id_ed25519.pub',
  'id_ecdsa',
  'id_ecdsa.pub',
  'id_dsa',
  'id_dsa.pub',
  '.npmrc',
  '.netrc',
  '.pgpass',
  '.pypirc',
  '.git-credentials',
  'credential',
  'credential.*',
  'credentials',
  'credentials.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  'api-token',
];

export const SECRET_FILE_REFUSAL = 'Spark never reads secret files like .env.';

export const SECRET_FILE_EXCEPTIONS: readonly string[] = ['.env.example'];

const SECRET_NAME_PATTERNS = SECRET_FILE_PATTERNS.map(
  (pattern) =>
    new RegExp(
      `^${pattern
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*')}$`,
    ),
);

export function isSecretFileName(name: string): boolean {
  const lower = name.toLowerCase();
  if (SECRET_FILE_EXCEPTIONS.includes(lower)) return false;
  return SECRET_NAME_PATTERNS.some((pattern) => pattern.test(lower));
}
