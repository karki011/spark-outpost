export interface ZoomClientConfig {
  clientId: string;
  oauthUrl: string;
  apiUrl: string;
}

interface ZoomEnv {
  SPARK_ZOOM_CLIENT_ID: string;
  ZOOM_OAUTH_URL?: string | undefined;
  ZOOM_API_URL?: string | undefined;
}

export const ZOOM_OAUTH_URL = 'https://zoom.us';
export const ZOOM_API_URL = 'https://api.zoom.us/v2';

export function zoomClientConfig(env: ZoomEnv): ZoomClientConfig | null {
  if (!env.SPARK_ZOOM_CLIENT_ID) return null;
  return {
    clientId: env.SPARK_ZOOM_CLIENT_ID,
    oauthUrl: env.ZOOM_OAUTH_URL ?? ZOOM_OAUTH_URL,
    apiUrl: env.ZOOM_API_URL ?? ZOOM_API_URL,
  };
}
