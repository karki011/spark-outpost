export const FEED_URL = 'https://pub-aae3512121074a13b84ee166f8d153af.r2.dev';

export type MacArch = 'arm64' | 'x64';

export interface ArchHints {
  platform?: string;
  architecture?: string;
  bitness?: string;
}

export interface ArchGuess {
  arch: MacArch;
  sure: boolean;
}

export function dmgUrl(arch: MacArch): string {
  return `${FEED_URL}/Spark-Outpost-latest-${arch}.dmg`;
}

export function archLabel(arch: MacArch): string {
  return arch === 'arm64' ? 'Apple silicon' : 'Intel';
}

export function guessArch(hints: ArchHints | null): ArchGuess {
  if (!hints || (hints.platform && hints.platform !== 'macOS')) {
    return { arch: 'arm64', sure: false };
  }
  if (hints.architecture === 'arm') return { arch: 'arm64', sure: true };
  if (hints.architecture === 'x86') return { arch: 'x64', sure: true };
  return { arch: 'arm64', sure: false };
}

interface UserAgentData {
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<ArchHints>;
}

export async function readArchHints(navigatorLike: {
  userAgentData?: UserAgentData;
}): Promise<ArchHints | null> {
  const data = navigatorLike.userAgentData;
  if (!data?.getHighEntropyValues) return null;
  try {
    const values = await data.getHighEntropyValues(['architecture', 'bitness']);
    return { ...values, platform: values.platform ?? data.platform ?? '' };
  } catch {
    return null;
  }
}
