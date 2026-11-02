export const CONTENT_SECURITY_POLICY_HEADER = 'Content-Security-Policy';

function policy(scriptSources: string, frameSources: string): string {
  return [
    "default-src 'self'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    `frame-src 'self' ${frameSources}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function appContentSecurityPolicy(artifactOrigin: string): string {
  return policy("'self'", artifactOrigin);
}

export function devContentSecurityPolicy(artifactOrigin: string): string {
  return policy("'self' 'unsafe-inline'", artifactOrigin);
}
