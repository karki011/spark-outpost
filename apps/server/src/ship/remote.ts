export interface RemoteRepo {
  host: string;
  owner: string;
  name: string;
}

const PART = /^[A-Za-z0-9._-]{1,100}$/;
const SCP_LIKE = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/;
const SSH_GITHUB_HOST = 'ssh.github.com';

function fromPath(host: string, path: string): RemoteRepo | null {
  const parts = path
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/, '')
    .split('/');
  if (parts.length !== 2) return null;
  const [owner, name] = parts as [string, string];
  if (!PART.test(owner) || !PART.test(name) || name === '.' || name === '..') return null;
  const normalizedHost = host.toLowerCase() === SSH_GITHUB_HOST ? 'github.com' : host.toLowerCase();
  return { host: normalizedHost, owner, name };
}

export function parseRemoteUrl(raw: string): RemoteRepo | null {
  const url = raw.trim();
  if (/^(https?|ssh|git):\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      const host = parsed.protocol.startsWith('http') ? parsed.host : parsed.hostname;
      return fromPath(host, decodeURIComponent(parsed.pathname));
    } catch {
      return null;
    }
  }
  const scp = SCP_LIKE.exec(url);
  if (scp && !url.startsWith('/') && !url.startsWith('.')) return fromPath(scp[1]!, scp[2]!);
  return null;
}

export const repoSlug = (repo: Pick<RemoteRepo, 'owner' | 'name'>) => `${repo.owner}/${repo.name}`;

export function apiBaseFor(host: string, override?: string): string {
  if (override) return override.replace(/\/$/, '');
  return host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
}
