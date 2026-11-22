import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';

interface FileResult {
  name: string;
  status: string;
}

interface VitestReport {
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  testResults: FileResult[];
}

function relative(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join('/');
}

async function summary(reportPath: string): Promise<string> {
  try {
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as VitestReport;
    const failed = report.testResults.filter((file) => file.status !== 'passed');
    return [
      `### Unit tests on ${process.platform}: ${report.numPassedTests} passed, ${report.numFailedTests} failed, ${report.numPendingTests} skipped`,
      '',
      `${failed.length} of ${report.testResults.length} files have failures:`,
      '',
      ...failed.map((file) => `- \`${relative(file.name)}\``),
      '',
    ].join('\n');
  } catch (error) {
    return `### Unit tests: no report (${(error as Error).message})\n`;
  }
}

const text = await summary(process.argv[2] ?? 'vitest-windows.json');
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, text);
