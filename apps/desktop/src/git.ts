import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type GitRunner = (file: string, args: string[]) => Promise<{ stdout: string }>;

export async function detectGit(runner: GitRunner = run): Promise<string | null> {
  try {
    const { stdout } = await runner('git', ['--version']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export const GIT_MISSING = {
  title: 'Git is not installed',
  message: 'Spark Outpost needs Git for code scans, task copies and shipping changes.',
  detail:
    'Install Apple’s command line tools by running this in Terminal:\n\n  xcode-select --install\n\nThen reopen Spark Outpost. Chats keep working without Git.',
};
