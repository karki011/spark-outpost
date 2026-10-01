import type { GuardResult } from './update-migration.ts';

type Failure = Extract<GuardResult, { status: 'restored' | 'unrestored' }>;

export interface FailureContext {
  appName: string;
  version: string;
  arch: string;
  feedUrl: string | null;
  userData: string;
}

export function isMigrationFailure(result: GuardResult): result is Failure {
  return result.status === 'restored' || result.status === 'unrestored';
}

export function failureDialog(result: Failure, context: FailureContext) {
  const restored = result.status === 'restored';
  return {
    message: `${context.appName} ${context.version} couldn't update your data.`,
    detail: restored
      ? `Nothing was lost: your data is back to how it was before this update. Keep using the previous version until a fix is out.\n\n${result.detail}`
      : `Your data could not be put back automatically. Don't delete anything; the instructions explain how to recover it.\n\n${result.detail}`,
  };
}

export function previousVersionInstructions(result: Failure, context: FailureContext): string {
  const previous = result.previousVersion ?? 'the version you used before';
  const download = context.feedUrl
    ? `${context.feedUrl}/Spark-Outpost-${result.previousVersion ?? '<version>'}-${context.arch}.dmg`
    : 'the download page or the copy you installed it from';
  const backup = result.backup
    ? `A backup taken just before the update is at:\n  ${result.backup.path}`
    : 'No backup was taken before the update.';
  const state =
    result.status === 'restored'
      ? 'Your data was restored from that backup, so the previous version will open it as before.'
      : 'Restoring the backup did not finish. Before reinstalling, ask for help and include the details below; the backup above is untouched.';
  return [
    `${context.appName} ${context.version} could not update your data`,
    '',
    state,
    '',
    backup,
    '',
    `To go back to ${previous}:`,
    `1. Quit ${context.appName}.`,
    `2. Download ${previous} for your Mac:`,
    `   ${download}`,
    `3. Open the download and drag ${context.appName} into Applications, replacing this version.`,
    `4. Open ${context.appName}. It skips ${context.version} and waits for the next release.`,
    '',
    `Your data folder: ${context.userData}`,
    '',
    'What went wrong:',
    result.detail,
    '',
  ].join('\n');
}
