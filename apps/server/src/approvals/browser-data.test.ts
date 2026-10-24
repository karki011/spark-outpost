import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODE_POSTURES } from '@spark-outpost/contracts';
import {
  BROWSER_DATA_REASON,
  browserDataDir,
  browserDataRules,
  globReachesBrowserData,
  isBrowserData,
  SPARK_RULES_REASON,
  sparkRulesFlagRules,
} from './browser-data.ts';
import { LOCAL_DATA_DIR } from '../config.ts';
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

  it("takes the folder from Spark's one data folder setting and never turns off", () => {
    expect(browserDataDir({ SPARK_DATA_DIR: '/nowhere/spark' })).toBe('/nowhere/spark');
    expect(browserDataDir({}, true)).toBe(LOCAL_DATA_DIR);
    expect(() => browserDataDir({}, false)).toThrow('SPARK_DATA_DIR is not set');
    expect(() => browserDataDir({ SPARK_DATA_DIR: 'relative' })).toThrow('absolute');
  });

  it('protects the data folder for a server started without a folder, from a checkout', () => {
    const asked = request({ command: `cat "${LOCAL_DATA_DIR}/postgres-password"` });
    const decision = decide('full_access', asked, NO_RUN_RULES, [], { files: NO_FILES });
    expect(decision).toEqual({ verdict: 'reject', reason: BROWSER_DATA_REASON });
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

describe("Spark's own rules file is refused to chats in every mode", () => {
  const refused = MODE_POSTURES.map(() => SPARK_RULES_REASON);
  const COMPANY = '/Library/Application Support/SparkOutpost/managed-settings.json';
  const MOVED = '/Users/me/rules/spark-settings.json';

  beforeEach(() => {
    vi.stubEnv('SPARK_RULES_FILE', `${DATA}/spark/settings.json`);
    vi.stubEnv('SPARK_MANAGED_RULES_FILE', COMPANY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    `cat "${DATA}/spark/settings.json"`,
    `echo '{}' > "${DATA}/spark/settings.json"`,
    'cat ../../../settings.json',
    `cat "${COMPANY}"`,
    `echo x > "${DATA}/spark/.settings-accepted.json"`,
  ])('%s', async (command) => {
    expect(await verdicts(request({ command }))).toEqual(refused);
  });

  it('refuses an edit of the file', async () => {
    const edit = request({
      kind: 'edit',
      toolKind: 'edit',
      paths: [`${DATA}/spark/settings.json`],
    });
    expect(await verdicts(edit)).toEqual(refused);
  });

  it('guards the file wherever it is configured, and the company file', async () => {
    vi.stubEnv('SPARK_RULES_FILE', MOVED);
    expect(await verdicts(request({ command: `cat ${MOVED}` }))).toEqual(refused);
    expect(await verdicts(request({ command: `cat "${DATA}/spark/settings.json"` }))).not.toEqual(
      refused,
    );
  });

  it('gives Claude read and edit deny rules for both files and the accepted copy', () => {
    expect(sparkRulesFlagRules()).toEqual([
      `Read(/${DATA}/spark/settings.json)`,
      `Edit(/${DATA}/spark/settings.json)`,
      `Read(/${DATA}/spark/.settings-accepted.json)`,
      `Edit(/${DATA}/spark/.settings-accepted.json)`,
      `Read(/${COMPANY})`,
      `Edit(/${COMPANY})`,
    ]);
  });

  it('leaves the chats folder beside it alone', async () => {
    expect(await verdicts(request({ command: 'cat notes.md' }))).not.toEqual(refused);
  });
});
