export const FEED_URL = 'https://pub-aae3512121074a13b84ee166f8d153af.r2.dev';
export const README_START = '<!-- release-downloads:start -->';
export const README_END = '<!-- release-downloads:end -->';

const REQUIREMENT = 'Requires macOS 13 or later (Mac control needs macOS 14).';
const VERSION_BADGE =
  /<img alt="Version [^"]*" src="https:\/\/img\.shields\.io\/badge\/version-[^"]*-2bb39a">/;
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

export function dmgUrl(version: string, arch: Arch): string {
  return `${FEED_URL}/Spark-Outpost-${version}-${arch}.dmg`;
}

export function latestDmgUrl(arch: Arch): string {
  return `${FEED_URL}/Spark-Outpost-latest-${arch}.dmg`;
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
    REQUIREMENT,
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
    'Every Spark Outpost version with a download, newest first. Once installed, the app updates itself.',
    '',
    REQUIREMENT,
    '',
    'The full history is in the [changelog](../apps/desktop/CHANGELOG.md).',
    '',
    '| Version | Released | Apple silicon | Intel |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

function downloadButton(arch: Arch, label: string, color: string): string {
  const badge = `https://img.shields.io/badge/Download_for_Mac-${label.replaceAll(' ', '_')}-${color}?style=for-the-badge&logo=apple&logoColor=white`;
  return `<a href="${latestDmgUrl(arch)}"><img alt="Download for Mac, ${label}" src="${badge}"></a>`;
}

export function renderReadmeSection(latest: Release): string {
  const { version } = latest;
  return [
    README_START,
    '',
    `${downloadButton('arm64', 'Apple silicon', '2bb39a')} ${downloadButton('x64', 'Intel', '555555')}`,
    '',
    `Free beta · [${version}](releases/${version}.md) · macOS 13+ (Mac control needs 14) · [All versions](releases/README.md)`,
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

export function versionBadge(version: string): string {
  const label = version.replaceAll('-', '--');
  return `<img alt="Version ${version}" src="https://img.shields.io/badge/version-${label}-2bb39a">`;
}

export function syncVersionBadge(readme: string, version: string): string {
  if (!VERSION_BADGE.test(readme)) throw new Error('README.md has no version badge');
  return readme.replace(VERSION_BADGE, versionBadge(version));
}
