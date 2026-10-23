import { describe, expect, it } from 'vitest';
import { MODE_POSTURES } from '@spark-outpost/contracts';
import {
  BROWSER_DATA_REASON,
  browserDataDir,
  browserDataRules,
  globReachesBrowserData,
  isBrowserData,
} from './browser-data.ts';
import { NO_RUN_RULES, decide, type ApprovalRequest } from './decide.ts';
import { parseShell } from './shell-parse.ts';

const DATA = '/Users/me/Library/Application Support/Spark Outpost';
const WORK = `${DATA}/spark/chats/0b9c3a7e-1f00-4c1e-9d55-6c3b2f0a1d11/work`;
const HOME = '/Users/me';
const NO_FILES = { glob: () => [], walk: () => [], script: () => null };

function request(overrides: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title: 'run',
    command: null,
    cwd: WORK,
    paths: [],
    diffs: [],
    options: [],
    roots: [{ path: WORK, ignore: [] }],
    home: HOME,
    ...overrides,
  };
}

async function verdicts(asked: ApprovalRequest, allowlist: readonly string[] = []) {
  const shell = asked.command ? await parseShell(asked.command) : null;
  const allowAll = { allow: [{ kind: 'edit' as const }], reject: [] };
  return MODE_POSTURES.map((posture) => {
    const decision = decide(posture, asked, allowAll, allowlist, {
      files: NO_FILES,
      shell,
      browserData: DATA,
    });
    return decision.verdict === 'reject' ? decision.reason : decision.verdict;
  });
}

const refusedEverywhere = MODE_POSTURES.map(() => BROWSER_DATA_REASON);

describe("Spark's browser data is refused to chats in every mode", () => {
  it.each([
    `cat "${DATA}/postgres-password"`,
    `cp -r "${DATA}/Partitions/spark-browser-personal" /tmp/x`,
    `tar czf /tmp/all.tgz "${DATA}"`,
    `rsync -a "${DATA}/" /tmp/copy`,
    `cat ../../../../postgres-password`,
    `cd "${DATA}" && cat postgres-password`,
    `ls "${DATA}"/Parti*`,
    `cat ~/Library/"Application Support"/Spark*/browser-origins.json`,
    `sqlite3 "${DATA}/Partitions/spark-browser-personal/History" .dump`,
    `python3 -c "print(open('${DATA}/postgres-password').read())"`,
    `rm -rf "${DATA}/backups"`,
    `dd if="${DATA}/postgres-password" of=/tmp/x`,
    `sqlite3 "${DATA}/Cookies" .dump`,
    `cp -r "${DATA}/Local Storage" /tmp/x`,
    `cat "${DATA}/Local State"`,
  ])('refuses %s', async (command) => {
    expect(await verdicts(request({ command }), [command.split(' ')[0]!])).toEqual(
      refusedEverywhere,
    );
  });

  it('refuses reading, searching and editing a protected file by path', async () => {
    const target = `${DATA}/Partitions/spark-browser-profile/Cookies`;
    for (const toolKind of ['read', 'search', 'edit']) {
      const kind = toolKind === 'edit' ? 'edit' : 'other';
      const asked = request({ kind, toolKind, command: null, paths: [target] });
      expect(await verdicts(asked)).toEqual(refusedEverywhere);
    }
  });

  it("leaves a no-project chat's own folder alone", async () => {
    const asked = request({ command: 'echo hi > notes.txt && cat notes.txt && ls *' });
    expect(await verdicts(asked)).not.toContain(BROWSER_DATA_REASON);
    const edit = request({ kind: 'edit', toolKind: 'edit', paths: [`${WORK}/notes.txt`] });
    expect(await verdicts(edit)).not.toContain(BROWSER_DATA_REASON);
  });

  it('is off when Spark has no browser data folder', async () => {
    const asked = request({ command: `cat "${DATA}/postgres-password"` });
    const decision = decide('full_access', asked, NO_RUN_RULES, [], {
      files: NO_FILES,
      browserData: null,
    });
    expect(decision.verdict === 'reject' ? decision.reason : null).not.toBe(BROWSER_DATA_REASON);
  });
});

describe('browser data paths', () => {
  it('matches the folder, its browser entries and their contents, ignoring case', () => {
    expect(isBrowserData(DATA, DATA)).toBe(true);
    expect(isBrowserData(`${DATA}/postgres/base/1`, DATA)).toBe(true);
    expect(isBrowserData(`${DATA.toLowerCase()}/partitions/x`, DATA)).toBe(
      process.platform === 'darwin',
    );
    expect(isBrowserData(`${DATA}/spark/chats/x/work/a`, DATA)).toBe(false);
    expect(isBrowserData(`${DATA}/logs/api.log`, DATA)).toBe(false);
    expect(isBrowserData(`${DATA}/IndexedDB/http_127.0.0.1_0.indexeddb.leveldb/1.log`, DATA)).toBe(
      true,
    );
  });

  it('treats /tmp and /private/tmp as one place', () => {
    expect(isBrowserData('/tmp/spark-data/postgres-password', '/private/tmp/spark-data')).toBe(
      true,
    );
  });

  it('catches a glob that names an entry or the folder, not one under an ancestor', () => {
    const reaches = (word: string, cwd = HOME) => globReachesBrowserData(word, cwd, HOME, DATA);
    expect(reaches(`${DATA}/*`)).toBe(true);
    expect(reaches(`${DATA}/Partitions/*/Cookies`)).toBe(true);
    expect(reaches('~/Library/Application Support/Spark*')).toBe(true);
    expect(reaches('~/*')).toBe(false);
    expect(reaches('*', WORK)).toBe(false);
    expect(reaches(`${DATA}/logs/*`)).toBe(false);
  });

  it('reads the folder from the environment only when it is absolute', () => {
    expect(browserDataDir({})).toBeNull();
    expect(browserDataDir({ SPARK_BROWSER_DATA_DIR: 'relative' })).toBeNull();
    expect(browserDataDir({ SPARK_BROWSER_DATA_DIR: '/nowhere/spark' })).toBe('/nowhere/spark');
  });

  it("gives Claude read and edit deny rules for each entry, not for the chats' folder", () => {
    const rules = browserDataRules(DATA);
    expect(rules).toContain(`Read(/${DATA}/Partitions/**)`);
    expect(rules).toContain(`Edit(/${DATA}/postgres-password)`);
    expect(rules.some((rule) => rule.includes('/spark/'))).toBe(false);
    expect(rules).not.toContain(`Read(/${DATA}/**)`);
    expect(browserDataRules(null)).toEqual([]);
  });
});
