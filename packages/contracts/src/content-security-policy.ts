export const CONTENT_SECURITY_POLICY_HEADER = 'Content-Security-Policy';

function policy(scriptSources: string): string {
  return [
    "default-src 'self'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export const APP_CONTENT_SECURITY_POLICY = policy("'self'");

export const DEV_CONTENT_SECURITY_POLICY = policy("'self' 'unsafe-inline'");
