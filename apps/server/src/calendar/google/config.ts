export interface GoogleClientConfig {
  clientId: string;
  clientSecret: string | null;
  verified: boolean;
  accountsUrl: string;
  oauthUrl: string;
  apiUrl: string;
}

interface GoogleEnv {
  SPARK_GOOGLE_CLIENT_ID: string;
  SPARK_GOOGLE_CLIENT_SECRET: string;
  SPARK_GOOGLE_VERIFIED: boolean;
  GOOGLE_ACCOUNTS_URL?: string | undefined;
  GOOGLE_OAUTH_URL?: string | undefined;
  GOOGLE_CALENDAR_API_URL?: string | undefined;
}

export const GOOGLE_ACCOUNTS_URL = 'https://accounts.google.com';
export const GOOGLE_OAUTH_URL = 'https://oauth2.googleapis.com';
export const GOOGLE_CALENDAR_API_URL = 'https://www.googleapis.com/calendar/v3';

export function googleClientConfig(env: GoogleEnv): GoogleClientConfig | null {
  if (!env.SPARK_GOOGLE_CLIENT_ID) return null;
  return {
    clientId: env.SPARK_GOOGLE_CLIENT_ID,
    clientSecret: env.SPARK_GOOGLE_CLIENT_SECRET || null,
    verified: env.SPARK_GOOGLE_VERIFIED,
    accountsUrl: env.GOOGLE_ACCOUNTS_URL ?? GOOGLE_ACCOUNTS_URL,
    oauthUrl: env.GOOGLE_OAUTH_URL ?? GOOGLE_OAUTH_URL,
    apiUrl: env.GOOGLE_CALENDAR_API_URL ?? GOOGLE_CALENDAR_API_URL,
  };
}
