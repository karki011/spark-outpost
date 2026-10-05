import { z } from 'zod';
import { projectSchema } from './projects.ts';

export const CLONE_NAME_MAX = 100;
export const CLONE_URL_MAX = 2048;

const TRANSPORT_HELPER = /^[A-Za-z0-9+.-]+::/;
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//;
const STANDARD = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:([^/@]*)@)?([^/:@]*)(?::\d{1,5})?(\/[^?#]*)?$/;
const SCP_LIKE = /^(?:([^@/\s:]+)@)?([^@/\s:]+):(?!\/\/)(\S+)$/;
const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const CONTROL_OR_SPACE = /[\s\p{Cc}]/u;
const NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

export interface CloneSource {
  url: string;
  transport: 'https' | 'ssh' | 'file';
  host: string;
  name: string;
}

export type CloneUrlResult = { ok: true; source: CloneSource } | { ok: false; message: string };

const refuse = (message: string): CloneUrlResult => ({ ok: false, message });

const CREDENTIALS_IN_URL =
  'That address has a username or password in it. Remove it and paste the plain address; Spark signs in with your GitHub connection or your own git setup.';

export const CLONE_URL_HELP =
  'Paste an https:// address or an SSH address such as git@github.com:owner/repo.git.';

function nameFromPath(path: string): string {
  const last =
    path
      .replace(/\/+$/, '')
      .split('/')
      .findLast((part) => part !== '') ?? '';
  const name = last.replace(/\.git$/i, '');
  return NAME.test(name) && name.length <= CLONE_NAME_MAX ? name : '';
}

interface StandardUrl {
  userinfo: string;
  host: string;
  path: string;
}

function standardParts(url: string): StandardUrl | null {
  const match = STANDARD.exec(url);
  if (!match) return null;
  try {
    return {
      userinfo: match[1] ?? '',
      host: match[2] ?? '',
      path: decodeURIComponent(match[3] ?? ''),
    };
  } catch {
    return null;
  }
}

function standardUrl(url: string, scheme: string, allowFile: boolean): CloneUrlResult {
  const parts = standardParts(url);
  if (!parts) return refuse(`That address is not valid. ${CLONE_URL_HELP}`);
  const { userinfo, host, path } = parts;
  if (scheme === 'file') {
    if (!allowFile) return refuse(`Spark can't clone from a file address. ${CLONE_URL_HELP}`);
    return { ok: true, source: { url, transport: 'file', host: '', name: nameFromPath(path) } };
  }
  if (scheme !== 'https' && scheme !== 'ssh') {
    return refuse(`Spark can't clone over ${scheme}://. ${CLONE_URL_HELP}`);
  }
  if (userinfo.includes(':') || (scheme === 'https' && userinfo !== '')) {
    return refuse(CREDENTIALS_IN_URL);
  }
  if (userinfo.startsWith('-') || !HOST.test(host) || path.replace(/\//g, '') === '') {
    return refuse(`That address is missing a host or a repository. ${CLONE_URL_HELP}`);
  }
  return {
    ok: true,
    source: { url, transport: scheme, host: host.toLowerCase(), name: nameFromPath(path) },
  };
}

export function parseCloneUrl(raw: string, options: { allowFile?: boolean } = {}): CloneUrlResult {
  const url = raw.trim();
  if (!url) return refuse(CLONE_URL_HELP);
  if (url.length > CLONE_URL_MAX) return refuse('That address is too long.');
  if (CONTROL_OR_SPACE.test(url))
    return refuse(`That address has a space in it. ${CLONE_URL_HELP}`);
  if (url.startsWith('-')) return refuse(`That is not a repository address. ${CLONE_URL_HELP}`);
  if (TRANSPORT_HELPER.test(url)) {
    return refuse(`Spark can't clone through a helper program. ${CLONE_URL_HELP}`);
  }
  const scheme = SCHEME.exec(url)?.[1]?.toLowerCase();
  if (scheme) return standardUrl(url, scheme, options.allowFile === true);
  if (url.startsWith('/') || url.startsWith('.') || url.startsWith('~')) {
    return refuse(
      `Spark can't clone from a folder on this Mac. Choose the folder instead. ${CLONE_URL_HELP}`,
    );
  }
  const scp = SCP_LIKE.exec(url);
  if (!scp) return refuse(`That is not a repository address. ${CLONE_URL_HELP}`);
  const [, user = '', host = '', path = ''] = scp;
  if (path.includes('@')) return refuse(CREDENTIALS_IN_URL);
  if (user.startsWith('-') || !HOST.test(host)) {
    return refuse(`That is not a repository address. ${CLONE_URL_HELP}`);
  }
  return {
    ok: true,
    source: { url, transport: 'ssh', host: host.toLowerCase(), name: nameFromPath(path) },
  };
}

export function cloneNameProblem(raw: string): string | null {
  const name = raw.trim();
  if (!name) return 'Give the folder a name.';
  if (name.length > CLONE_NAME_MAX) {
    return `Use a folder name of ${CLONE_NAME_MAX} characters or fewer.`;
  }
  if (/[/\\]/.test(name)) return 'A folder name can’t contain a slash.';
  if (name.startsWith('.') || name.startsWith('-')) {
    return 'A folder name can’t start with a dot or a dash.';
  }
  if (!NAME.test(name)) return 'Use letters, numbers, dots, dashes and underscores.';
  return null;
}

export const startCloneRequestSchema = z.object({
  url: z.string().trim().min(1).max(CLONE_URL_MAX),
  parentPath: z.string().trim().min(1).max(4096),
  name: z.string().trim().min(1).max(CLONE_NAME_MAX),
});
export type StartCloneRequest = z.infer<typeof startCloneRequestSchema>;

export const cloneFailureKindSchema = z.enum([
  'auth',
  'not_found',
  'network',
  'destination',
  'disk',
  'interrupted',
  'other',
]);
export type CloneFailureKind = z.infer<typeof cloneFailureKindSchema>;

export const cloneJobSchema = z.object({
  id: z.uuid(),
  source: z.string(),
  destination: z.string(),
  displayPath: z.string(),
  status: z.enum(['cloning', 'done', 'failed', 'cancelled']),
  phase: z.string(),
  percent: z.number().int().min(0).max(100).nullable(),
  project: projectSchema.nullable(),
  failure: z
    .object({ kind: cloneFailureKindSchema, summary: z.string(), detail: z.string() })
    .nullable(),
  startedAt: z.string(),
});
export type CloneJob = z.infer<typeof cloneJobSchema>;

export const cloneJobsSchema = z.object({ jobs: z.array(cloneJobSchema) });
export type CloneJobs = z.infer<typeof cloneJobsSchema>;

export const cloneRepoSchema = z.object({ slug: z.string(), url: z.string() });
export type CloneRepo = z.infer<typeof cloneRepoSchema>;

export const cloneOptionsSchema = z.object({
  defaultParent: z.string(),
  connected: z.boolean(),
  repos: z.array(cloneRepoSchema),
  truncated: z.boolean(),
  listError: z.string().nullable(),
});
export type CloneOptions = z.infer<typeof cloneOptionsSchema>;
