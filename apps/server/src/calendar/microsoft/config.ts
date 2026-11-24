export interface MicrosoftClientConfig {
  clientId: string;
  loginUrl: string;
  graphUrl: string;
}

interface MicrosoftEnv {
  SPARK_MICROSOFT_CLIENT_ID: string;
  MICROSOFT_LOGIN_URL?: string | undefined;
  MICROSOFT_GRAPH_URL?: string | undefined;
}

export const MICROSOFT_LOGIN_URL = 'https://login.microsoftonline.com';
export const MICROSOFT_GRAPH_URL = 'https://graph.microsoft.com/v1.0';
export const MICROSOFT_TENANT = 'common';

export function microsoftClientConfig(env: MicrosoftEnv): MicrosoftClientConfig | null {
  if (!env.SPARK_MICROSOFT_CLIENT_ID) return null;
  return {
    clientId: env.SPARK_MICROSOFT_CLIENT_ID,
    loginUrl: env.MICROSOFT_LOGIN_URL ?? MICROSOFT_LOGIN_URL,
    graphUrl: env.MICROSOFT_GRAPH_URL ?? MICROSOFT_GRAPH_URL,
  };
}
