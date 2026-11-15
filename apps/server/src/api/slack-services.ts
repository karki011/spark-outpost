import type { Config } from '../config.ts';
import type { Db } from '../persistence/db.ts';
import type { SecretStore } from '../setup/secrets.ts';
import { ClientFocus } from '../slack/client-focus.ts';
import { startSlackMentionWatch } from '../slack/mentions.ts';
import { FOCUS_TTL_MS, startSlackNotifier } from '../slack/notifier.ts';
import { slackSignInConfig } from '../slack/sign-in-config.ts';

export function startSlackServices(
  config: Config,
  base: { db: Db; workspaceId: string; secrets: SecretStore },
) {
  const slackSignIn = slackSignInConfig(config);
  const slackDeps = { ...base, fetch, slackApiUrl: config.SLACK_API_URL, signIn: slackSignIn };
  const focus = new ClientFocus(Date.now, FOCUS_TTL_MS);
  return {
    slackSignIn,
    slackDeps,
    focus,
    slackNotifier: startSlackNotifier(slackDeps, { linkScheme: config.SPARK_LINK_SCHEME, focus }),
    slackMentions: startSlackMentionWatch(slackDeps, { log: console.warn }),
  };
}
