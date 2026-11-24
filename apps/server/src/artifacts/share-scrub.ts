import { projectSecretValues } from '../audit/secret-values.ts';
import { projectSignInSecrets } from '../browser/sign-ins.ts';
import { chatWorkFolder } from '../chat-files/folders.ts';
import type { Queryable } from '../persistence/db.ts';
import type { SecretStore } from '../setup/secrets.ts';
import { scrubberFor, secretFileScrubber } from '../spark-mcp/tools/browser/scrub.ts';
import { chatHome } from '../spark-mcp/tools/browser/context.ts';

export interface ShareScrubDeps {
  db: Queryable;
  secrets: Pick<SecretStore, 'get'>;
  chatFolders: string;
}

export class ShareScrubError extends Error {}

const KEYCHAIN_UNREADABLE =
  'Spark could not read the keychain to check this page for saved sign-ins. Try again in a moment.';

export async function holdsSecret(
  deps: ShareScrubDeps,
  conversationId: string,
  text: string,
): Promise<boolean> {
  const home = await chatHome(deps.db, conversationId);
  const signIns = home.projectId
    ? await projectSignInSecrets(deps, home.projectId).catch(() => {
        throw new ShareScrubError(KEYCHAIN_UNREADABLE);
      })
    : [];
  const roots = [...home.roots, chatWorkFolder(deps.chatFolders, conversationId)];
  const scrubs = [scrubberFor(signIns), secretFileScrubber(await projectSecretValues(roots))];
  return scrubs.some((scrub) => scrub !== null && scrub(text) !== text);
}
