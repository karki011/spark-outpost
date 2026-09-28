import { join } from 'node:path';
import { testsGreen, type TestCounts } from '../../bench/verify.ts';
import { hiddenCounts, suiteCounts } from './hidden.ts';
import { applyPatch, createRepo, git, restore, settle, type DayRepo } from './repos.ts';
import { SESSIONS, type RepoKey } from './sessions.ts';

export interface SelfTestLine {
  session: string;
  before: TestCounts | null;
  after: TestCounts | null;
  suite: TestCounts | null;
  ok: boolean;
  note: string;
}

const show = (counts: TestCounts | null) =>
  counts ? `${counts.pass}/${counts.tests}` : 'no result';

export async function selfTest(dir: string): Promise<SelfTestLine[]> {
  const lines: SelfTestLine[] = [];
  const repos = new Map<RepoKey, DayRepo>();
  for (const session of SESSIONS) {
    if (!session.expect.hidden && !session.plantBefore) {
      lines.push({
        session: session.id,
        before: null,
        after: null,
        suite: null,
        ok: true,
        note: 'no hidden test',
      });
      continue;
    }
    let repo = repos.get(session.repo);
    if (!repo) {
      repo = await createRepo(session.repo, dir, `selftest-${session.repo}`);
      repos.set(session.repo, repo);
    }
    const base = git(repo.path, 'rev-parse', 'HEAD').trim();
    const scratch = join(dir, 'scratch');
    if (session.plantBefore) {
      await applyPatch(repo.path, session.plantBefore);
      restore(repo, dir, base);
    }
    if (!session.expect.hidden) {
      lines.push({
        session: session.id,
        before: null,
        after: null,
        suite: null,
        ok: true,
        note: 'no hidden test',
      });
      continue;
    }
    const before = await hiddenCounts(session.repo, repo.path, session.expect.hidden, scratch);
    await settle(repo, dir, base, session.reference, `Reference for ${session.id}`);
    const after = await hiddenCounts(session.repo, repo.path, session.expect.hidden, scratch);
    const suite = await suiteCounts(session.repo, repo.path, scratch);
    const ok = !testsGreen(before) && testsGreen(after) && testsGreen(suite);
    lines.push({
      session: session.id,
      before,
      after,
      suite,
      ok,
      note: `hidden ${show(before)} before, ${show(after)} with the reference; suite ${show(suite)}`,
    });
  }
  return lines;
}
