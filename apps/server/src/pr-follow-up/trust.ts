import { z } from 'zod';
import type { FeedbackKind } from '@spark-outpost/contracts';
import { repoPath, type GitHubConnection, type RepoRef } from '../ship/github/connection.ts';

const permissionSchema = z.object({
  permission: z.string(),
  role_name: z.string().nullable().optional(),
});

const WRITE_PERMISSIONS = new Set(['admin', 'maintain', 'write']);

export function canWrite(answer: z.infer<typeof permissionSchema> | null): boolean {
  if (!answer) return false;
  return WRITE_PERMISSIONS.has(answer.permission) || WRITE_PERMISSIONS.has(answer.role_name ?? '');
}

export function isBot(author: string): boolean {
  return author.endsWith('[bot]') || author === 'ghost';
}

export function isTrusted(
  item: { kind: FeedbackKind; author: string },
  writers: ReadonlySet<string>,
): boolean {
  if (item.kind === 'check') return true;
  return writers.has(item.author.toLowerCase());
}

async function permissionOf(
  connection: GitHubConnection,
  repo: RepoRef,
  author: string,
): Promise<z.infer<typeof permissionSchema> | null> {
  return connection
    .get(
      `${repoPath(repo)}/collaborators/${encodeURIComponent(author)}/permission`,
      permissionSchema,
      `checking what ${author} can do in the repository`,
    )
    .catch(() => null);
}

export async function writersAmong(
  connection: GitHubConnection,
  repo: RepoRef,
  authors: Iterable<string>,
): Promise<Set<string>> {
  const writers = new Set<string>();
  for (const author of new Set(authors)) {
    if (isBot(author)) continue;
    if (canWrite(await permissionOf(connection, repo, author))) writers.add(author.toLowerCase());
  }
  return writers;
}
