import type { FullConfig } from '@playwright/test';

export default function requireSingleWorker(config: FullConfig): void {
  if (config.workers <= 1) return;
  throw new Error(
    `Browser tests share one test database and one server stack, so they need one worker (got ${config.workers}). ` +
      'For a parallel run, use a second worktree with its own TEST_DATABASE_URL.',
  );
}
