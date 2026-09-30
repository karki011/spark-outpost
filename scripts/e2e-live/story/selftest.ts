import { outOfScope } from '../../bench/verify.ts';
import { changedFiles, snapshot } from '../dev-day/repos.ts';
import { applyReference, createStoryRepo, storyHidden, storySuite } from './repo.ts';
import { STORY_ALLOWED, STORY_HIDDEN_TESTS } from './story.ts';

export interface SelfTestLine {
  ok: boolean;
  what: string;
  detail: string;
}

const counted = (value: { pass: number; tests: number } | null) =>
  value ? `${value.pass}/${value.tests}` : 'no result';

export async function storySelfTest(dir: string): Promise<SelfTestLine[]> {
  const repo = await createStoryRepo(dir, `selftest-${Date.now()}`);
  const lines: SelfTestLine[] = [];
  const baseSuite = await storySuite(repo.path);
  lines.push({
    ok: baseSuite.counts !== null && baseSuite.counts.fail === 0,
    what: 'the fixture suite is green before the story',
    detail: counted(baseSuite.counts),
  });
  const baseHidden = await storyHidden(repo.path);
  lines.push({
    ok: baseHidden.counts?.tests === STORY_HIDDEN_TESTS && baseHidden.counts.pass <= 1,
    what: 'the hidden tests fail before the story',
    detail: `${counted(baseHidden.counts)} (${baseHidden.failing.length} failing)`,
  });
  const before = snapshot(repo.path);
  await applyReference(repo.path);
  const hidden = await storyHidden(repo.path);
  lines.push({
    ok: hidden.counts?.tests === STORY_HIDDEN_TESTS && hidden.counts.fail === 0,
    what: 'the reference passes every hidden test',
    detail: `${counted(hidden.counts)} ${hidden.failing.join('; ')}`,
  });
  const suite = await storySuite(repo.path);
  lines.push({
    ok: suite.counts !== null && suite.counts.fail === 0 && suite.counts.tests > 0,
    what: 'the reference keeps the suite green',
    detail: counted(suite.counts),
  });
  const outside = outOfScope(changedFiles(repo.path, before), STORY_ALLOWED);
  lines.push({
    ok: outside.length === 0,
    what: 'the reference stays inside the story areas',
    detail: outside.join(', ') || 'inside',
  });
  return lines;
}
