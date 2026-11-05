import { redacted } from '../../../audit/redact.ts';
import { projectSecretValues } from '../../../audit/secret-values.ts';
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

function withoutClippedTails(text: string, needles: readonly string[], mark: string): string {
  let result = text;
  let at = result.indexOf(CLIP_MARK);
  while (at !== -1) {
    const size = Math.max(...needles.map((needle) => clippedTail(result, at, needle)));
    if (size > 0) {
      result = `${result.slice(0, at - size)}${mark}${result.slice(at)}`;
      at += mark.length - size;
    }
    at = result.indexOf(CLIP_MARK, at + 1);
  }
  return result;
}

function valueScrubber(values: readonly string[], mark: string): Scrub | null {
  const needles = [...new Set(values.flatMap(spellings))]
    .filter((needle) => needle.length > 0)
    .sort((a, b) => b.length - a.length);
  if (needles.length === 0) return null;
  return (text) => {
    const whole = needles.reduce((kept, needle) => kept.split(needle).join(mark), text);
    return withoutClippedTails(whole, needles, mark);
  };
}

export function scrubberFor(secrets: readonly SignInSecret[]): Scrub | null {
  const values = secrets.flatMap((secret) => [secret.username, secret.password]);
  return valueScrubber(values, SIGN_IN_HIDDEN);
}

export function secretFileScrubber(values: readonly string[]): Scrub | null {
  return valueScrubber(values, redacted('secret_value'));
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

export async function pageScrub(context: SparkToolContext): Promise<Scrub> {
  const signIns = await signInScrub(context);
  const conversationId = context.scope.conversationId;
  const roots = conversationId ? (await chatHome(context.deps.db, conversationId)).roots : [];
  const files = secretFileScrubber(await projectSecretValues(roots));
  return (text) => {
    const withoutSignIns = signIns ? signIns(text) : text;
    return files ? files(withoutSignIns) : withoutSignIns;
  };
}
