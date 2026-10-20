import { describe, expect, it } from 'vitest';
import {
  README_END,
  README_START,
  downloadableReleases,
  parseChangelog,
  releaseDate,
  renderIndex,
  renderReadmeSection,
  renderVersionPage,
  replaceReadmeSection,
  syncVersionBadge,
} from './release-downloads-render.ts';

const changelog = [
  '# Spark Outpost changelog',
  '',
  'Newest first.',
  '',
  '## 0.1.0-beta.3',
  '',
  '- Calendar: Today shows your day.',
  '- Fixes: Refresh no longer reverts.',
  '',
  '## 0.1.0-beta.2',
  '',
  '- Voice: push to talk.',
  '',
  '## 0.1.0-beta.1',
  '',
  'First beta for a few testers.',
  '',
].join('\n');

const feed = 'https://pub-aae3512121074a13b84ee166f8d153af.r2.dev';

describe('release downloads', () => {
  it('reads each version section newest first and drops versions without a disk image', () => {
    const releases = parseChangelog(changelog);
    expect(releases.map((release) => release.version)).toEqual([
      '0.1.0-beta.3',
      '0.1.0-beta.2',
      '0.1.0-beta.1',
    ]);
    expect(releases[0]?.body).toBe(
      '- Calendar: Today shows your day.\n- Fixes: Refresh no longer reverts.',
    );
    expect(downloadableReleases(releases).map((release) => release.version)).toEqual([
      '0.1.0-beta.3',
      '0.1.0-beta.2',
    ]);
  });

  it('renders a version page with both downloads, the requirement and the changes', () => {
    const [release] = parseChangelog(changelog);
    if (!release) throw new Error('no release');
    const page = renderVersionPage(release, '2026-10-19');
    expect(page).toContain('Released 2026-10-19.');
    expect(page).toContain(`(${feed}/Spark-Outpost-0.1.0-beta.3-arm64.dmg)`);
    expect(page).toContain(`(${feed}/Spark-Outpost-0.1.0-beta.3-x64.dmg)`);
    expect(page).toContain('Requires macOS 12 or later (Mac control needs macOS 14).');
    expect(page).toContain('- Fixes: Refresh no longer reverts.');
    expect(releaseDate(page)).toBe('2026-10-19');
    expect(renderVersionPage(release, undefined)).not.toContain('Released');
  });

  it('renders an index row per version, newest first', () => {
    const releases = downloadableReleases(parseChangelog(changelog));
    const index = renderIndex(releases, new Map([['0.1.0-beta.3', '2026-10-19']]));
    const rows = index.split('\n').filter((line) => line.startsWith('| ['));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('[0.1.0-beta.3](0.1.0-beta.3.md) | 2026-10-19 |');
    expect(rows[1]).toContain('[0.1.0-beta.2](0.1.0-beta.2.md) |  |');
    expect(index).toContain('Versions before 0.1.0-beta.2 have no disk image');
  });

  it('replaces only the marked README section', () => {
    const readme = `# Title\n\n${README_START}\nold\n${README_END}\n\nRest.\n`;
    const [latest] = parseChangelog(changelog);
    if (!latest) throw new Error('no release');
    const updated = replaceReadmeSection(readme, renderReadmeSection(latest));
    expect(updated.startsWith('# Title\n\n')).toBe(true);
    expect(updated.endsWith(`${README_END}\n\nRest.\n`)).toBe(true);
    expect(updated).not.toContain('old');
    expect(updated).toContain('Latest: **0.1.0-beta.3**');
    expect(updated).toContain('[All versions](releases/README.md)');
    expect(replaceReadmeSection(updated, renderReadmeSection(latest))).toBe(updated);
    expect(() => replaceReadmeSection('# Title\n', 'x')).toThrow(/markers/);
  });

  it('sets the README version badge to the latest version', () => {
    const readme =
      '<a href="x"><img alt="Version 0.1.0-beta.1" src="https://img.shields.io/badge/version-0.1.0--beta.1-2bb39a"></a>\n';
    expect(syncVersionBadge(readme, '0.1.0-beta.23')).toBe(
      '<a href="x"><img alt="Version 0.1.0-beta.23" src="https://img.shields.io/badge/version-0.1.0--beta.23-2bb39a"></a>\n',
    );
    expect(() => syncVersionBadge('# Title\n', '0.1.0')).toThrow(/badge/);
  });
});
