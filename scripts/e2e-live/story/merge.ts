import { readFile, writeFile } from 'node:fs/promises';
import type { StoryRun } from './record.ts';
import { renderStoryReport } from './report-story.ts';
import { criticBeyond, STORY_HARD_CAP_USD } from './run-story.ts';
import { developerMinutes, storyPassed } from './summary.ts';

export async function mergeRuns(paths: readonly string[], out: string): Promise<StoryRun> {
  const runs = await Promise.all(
    paths.map(async (path) => JSON.parse(await readFile(path, 'utf8')) as StoryRun),
  );
  const first = runs[0];
  if (!first) throw new Error('Pass at least one story JSON to merge.');
  const records = runs.flatMap((run) =>
    run.records.map((record) => {
      const passed = storyPassed(record.failedChecks);
      return {
        ...record,
        passed,
        userMinutes: developerMinutes({ ...record, passed }, run.rates),
        criticBeyondChecks: criticBeyond(record.fullChecks, record.critic),
      };
    }),
  );
  const merged: StoryRun = {
    ...first,
    date: runs
      .map((run) => run.date)
      .sort()
      .at(-1)!,
    budgetUsd: STORY_HARD_CAP_USD,
    spentUsd: runs.reduce((sum, run) => sum + run.spentUsd, 0),
    stopped: runs.flatMap((run) => (run.stopped ? [run.stopped] : [])).join(' ') || null,
    arms: [...new Set(runs.flatMap((run) => run.arms))],
    setup: Object.assign({}, ...runs.map((run) => run.setup)) as Record<string, string>,
    records,
  };
  await writeFile(out, `${JSON.stringify(merged, null, 2)}\n`);
  await writeFile(out.replace(/\.json$/, '.md'), renderStoryReport(merged));
  return merged;
}
