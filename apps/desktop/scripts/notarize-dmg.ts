import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

type Env = Record<string, string | undefined>;
type Runner = (command: string, args: string[]) => Promise<unknown>;

const execFileAsync = promisify(execFile);
const defaultRunner: Runner = (command, args) => execFileAsync(command, args);

export function notaryCredentialArgs(env: Env): string[] | null {
  if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) {
    return [
      '--key',
      env.APPLE_API_KEY,
      '--key-id',
      env.APPLE_API_KEY_ID,
      '--issuer',
      env.APPLE_API_ISSUER,
    ];
  }
  if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) {
    return [
      '--apple-id',
      env.APPLE_ID,
      '--password',
      env.APPLE_APP_SPECIFIC_PASSWORD,
      '--team-id',
      env.APPLE_TEAM_ID,
    ];
  }
  if (env.APPLE_KEYCHAIN && env.APPLE_KEYCHAIN_PROFILE) {
    return ['--keychain-profile', env.APPLE_KEYCHAIN_PROFILE, '--keychain', env.APPLE_KEYCHAIN];
  }
  return null;
}

export async function notarizeDmgs(
  artifacts: string[],
  env: Env,
  runner: Runner = defaultRunner,
): Promise<string[]> {
  const credentials = notaryCredentialArgs(env);
  if (!credentials) throw new Error('Notarization credentials are missing for the DMG.');
  const dmgs = artifacts.filter((artifact) => artifact.endsWith('.dmg'));
  for (const dmg of dmgs) {
    try {
      await runner('xcrun', ['notarytool', 'submit', dmg, '--wait', ...credentials]);
    } catch {
      throw new Error(`Apple did not accept ${dmg} for notarization. Check notarytool history.`);
    }
    await runner('xcrun', ['stapler', 'staple', dmg]);
  }
  return dmgs;
}
