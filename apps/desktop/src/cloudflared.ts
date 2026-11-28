export const CLOUDFLARED_MIN_MACOS = '15.0';

export interface CloudflaredSource {
  bundled: string;
  override: string | undefined;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  systemVersion: string;
}

export function cloudflaredBin(source: CloudflaredSource): string {
  if (!source.isPackaged && source.override) return source.override;
  if (source.platform !== 'darwin') return '';
  const major = Number(source.systemVersion.split('.')[0]);
  return major >= Number(CLOUDFLARED_MIN_MACOS) ? source.bundled : '';
}

export function bundledCloudflared(bundled: string, isPackaged: boolean): string {
  return cloudflaredBin({
    bundled,
    isPackaged,
    override: process.env.SPARK_CLOUDFLARED_BIN,
    platform: process.platform,
    systemVersion: process.getSystemVersion(),
  });
}
