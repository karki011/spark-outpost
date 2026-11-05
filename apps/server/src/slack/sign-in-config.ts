import { SPARK_URL_SCHEME, slackCallbackUri } from '@spark-outpost/contracts';

export interface SlackSignInConfig {
  clientId: string;
  linkScheme: string;
  redirectUri: string;
}

interface SignInEnv {
  SPARK_SLACK_CLIENT_ID: string;
  SPARK_LINK_SCHEME?: string | undefined;
}

export function slackSignInConfig(env: SignInEnv): SlackSignInConfig | null {
  if (!env.SPARK_SLACK_CLIENT_ID) return null;
  const linkScheme = env.SPARK_LINK_SCHEME ?? SPARK_URL_SCHEME;
  return {
    clientId: env.SPARK_SLACK_CLIENT_ID,
    linkScheme,
    redirectUri: slackCallbackUri(linkScheme),
  };
}
