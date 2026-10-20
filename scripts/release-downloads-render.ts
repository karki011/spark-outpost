export const FEED_URL = 'https://pub-aae3512121074a13b84ee166f8d153af.r2.dev';
export const README_START = '<!-- release-downloads:start -->';
export const README_END = '<!-- release-downloads:end -->';

const VERSIONS_WITHOUT_DMG = new Set(['0.1.0-beta.1']);
const DATE_LINE = /^Released (\d{4}-\d{2}-\d{2})\.$/m;

export type Release = { version: string; body: string };

export type Arch = 'arm64' | 'x64';

export function parseChangelog(changelog: string): Release[] {
  const releases: Release[] = [];
  let current: { version: string; lines: string[] } | undefined;
  const finish = () => {
    if (current) releases.push({ version: current.version, body: current.lines.join('\n').trim() });
  };
  for (const line of changelog.split('\n')) {
    const heading = /^## (?<version>\S+)\s*$/.exec(line)?.groups?.version;
    if (heading) {
      finish();
      current = { version: heading, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  finish();
  return releases;
}

export function downloadableReleases(releases: Release[]): Release[] {
  return releases.filter((release) => !VERSIONS_WITHOUT_DMG.has(release.version));
}

export function dmgUrl(version: string, arch: Arch): string {
  return `${FEED_URL}/Spark-Outpost-${version}-${arch}.dmg`;
}

export function releaseDate(page: string | undefined): string | undefined {
  return page ? DATE_LINE.exec(page)?.[1] : undefined;
}

export function renderVersionPage(release: Release, date: string | undefined): string {
  const lines = [`# Spark Outpost ${release.version}`, ''];
  if (date) lines.push(`Released ${date}.`, '');
  lines.push(
    `- [Download for Apple silicon](${dmgUrl(release.version, 'arm64')})`,
    `- [Download for Intel](${dmgUrl(release.version, 'x64')})`,
    '',
    'Requires macOS 14 or later.',
    '',
    '## Changes',
    '',
    release.body,
    '',
    '[All versions](README.md)',
    '',
  );
  return lines.join('\n');
}

export function renderIndex(releases: Release[], dates: Map<string, string | undefined>): string {
  const rows = releases.map((release) => {
    const { version } = release;
    const date = dates.get(version) ?? '';
    return `| [${version}](${version}.md) | ${date} | [Download](${dmgUrl(version, 'arm64')}) | [Download](${dmgUrl(version, 'x64')}) |`;
  });
  return [
    '# Spark Outpost downloads',
    '',
    'Every Spark Outpost version with a download, newest first. Each needs macOS 14 or later. Once installed, the app updates itself.',
    '',
    `Versions before ${releases.at(-1)?.version ?? 'these'} have no disk image on the update feed and are not listed. The full history is in the [changelog](../apps/desktop/CHANGELOG.md).`,
    '',
    '| Version | Released | Apple silicon | Intel |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

export function renderReadmeSection(latest: Release): string {
  return [
    README_START,
    '',
    '## Download',
    '',
    `Latest: **${latest.version}** ([what's new](releases/${latest.version}.md)). Requires macOS 14 or later.`,
    '',
    `- [Download for Apple silicon](${dmgUrl(latest.version, 'arm64')})`,
    `- [Download for Intel](${dmgUrl(latest.version, 'x64')})`,
    '- [All versions](releases/README.md)',
    '',
    README_END,
  ].join('\n');
}

export function replaceReadmeSection(readme: string, section: string): string {
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`README.md needs ${README_START} and ${README_END} markers`);
  }
  return readme.slice(0, start) + section + readme.slice(end + README_END.length);
}
