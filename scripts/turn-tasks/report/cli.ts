import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { readChecks, readRecords, resultsDir } from '../runner/results.ts';
import { renderReport } from './render.ts';
import { selectRuns } from './select.ts';

const { values } = parseArgs({
  options: { label: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
});
if (!values.label) throw new Error('Name the results to report with --label.');

const dryRun = values['dry-run'];
const chosen = selectRuns(await readRecords(values.label), await readChecks(values.label), dryRun);
const report = renderReport(values.label, chosen.records, chosen.checks, dryRun);
const file = join(resultsDir(values.label), dryRun ? 'report-dry-run.md' : 'report.md');
await writeFile(file, report);
console.log(report);
if (chosen.leftOut > 0) {
  console.log(`${chosen.leftOut} ${dryRun ? 'live' : 'dry-run'} records are left out.`);
}
console.log(`Written to ${file}`);
