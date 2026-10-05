import { projectSignInSecrets, type SignInSecret } from '../../../browser/sign-ins.ts';
import { SparkToolError, type SparkToolContext } from '../../tool.ts';
import { chatHome } from './context.ts';

export type Scrub = (text: string) => string;

export const SIGN_IN_HIDDEN = '[saved sign-in]';
const CLIP_MARK = '…';
const CLIPPED_MIN = 4;

const KEYCHAIN_UNREADABLE =
  'Spark could not read the keychain to keep saved sign-ins out of this result. Try again in a moment.';

function spellings(value: string): string[] {
  const encoded = encodeURIComponent(value);
  return [value, encoded, encoded.replace(/%20/g, '+'), JSON.stringify(value).slice(1, -1)];
}

function clippedTail(text: string, end: number, needle: string): number {
  const longest = Math.min(needle.length - 1, end);
  for (let size = longest; size >= CLIPPED_MIN; size -= 1) {
    if (text.startsWith(needle.slice(0, size), end - size)) return size;
  }
  return 0;
}

function withoutClippedTails(text: string, needles: readonly string[]): string {
  let result = text;
  let at = result.indexOf(CLIP_MARK);
  while (at !== -1) {
    const size = Math.max(...needles.map((needle) => clippedTail(result, at, needle)));
    if (size > 0) {
      result = `${result.slice(0, at - size)}${SIGN_IN_HIDDEN}${result.slice(at)}`;
      at += SIGN_IN_HIDDEN.length - size;
    }
    at = result.indexOf(CLIP_MARK, at + 1);
  }
  return result;
}

export function scrubberFor(secrets: readonly SignInSecret[]): Scrub | null {
  const values = secrets.flatMap((secret) => [secret.username, secret.password]);
  const needles = [...new Set(values.flatMap(spellings))]
    .filter((needle) => needle.length > 0)
    .sort((a, b) => b.length - a.length);
  if (needles.length === 0) return null;
  return (text) => {
    const whole = needles.reduce((kept, needle) => kept.split(needle).join(SIGN_IN_HIDDEN), text);
    return withoutClippedTails(whole, needles);
  };
}

export async function signInScrub(context: SparkToolContext): Promise<Scrub | null> {
  const conversationId = context.scope.conversationId;
  if (!conversationId) return null;
  const { projectId } = await chatHome(context.deps.db, conversationId);
  if (!projectId) return null;
  const secrets = await projectSignInSecrets(context.deps, projectId).catch(() => {
    throw new SparkToolError(KEYCHAIN_UNREADABLE);
  });
  return scrubberFor(secrets);
}
