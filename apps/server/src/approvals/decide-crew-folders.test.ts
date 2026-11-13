import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import { BROWSER_DATA_REASON, SPARK_RULES_REASON } from './browser-data.ts';
import { CREW_FOLDER_REASON, crewFolderRules } from './crew-folders.ts';
import { NO_RUN_RULES, decide, type ApprovalRequest } from './decide.ts';
import { parseShell } from './shell-parse.ts';

const ROOT = '/work/app';
const HOME = '/Users/me';
const DATA = '/data';
const SPARKS = `${DATA}/dev/sparks`;
const WORKFLOWS = `${DATA}/dev/workflows`;
const OWN = `${SPARKS}/11111111-1111-4111-8111-111111111111`;
const OTHER = `${SPARKS}/22222222-2222-4222-8222-222222222222`;
const CHAT = `${DATA}/dev/chats/33333333-3333-4333-8333-333333333333/work`;
const RULES_FILE = process.env.SPARK_RULES_FILE!;
const NO_FILES = { glob: () => [], walk: () => [], script: () => null };
const MODES: ModePosture[] = ['asks', 'auto', 'full_access'];
const OUTSIDE_READ = 'refuse (Reads outside the project are refused)';
const REFUSED = `refuse (${CREW_FOLDER_REASON})`;

function request(overrides: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title: 'run',
    command: null,
    cwd: ROOT,
    paths: [],
    diffs: [],
    options: [],
    roots: [{ path: ROOT, ignore: [] }],
    home: HOME,
    readable: [OWN],
    ...overrides,
  };
}

function shown(decision: ReturnType<typeof decide>): string {
  if (decision.verdict === 'allow') return 'allow';
  if (decision.verdict === 'reject') return `refuse (${decision.reason})`;
  return `ask (${decision.reason ?? 'the mode asks'})`;
}

async function decided(asked: ApprovalRequest): Promise<string[]> {
  const shell = asked.command ? await parseShell(asked.command) : null;
  return MODES.map((posture) =>
    shown(
      decide(posture, asked, NO_RUN_RULES, [], {
        files: NO_FILES,
        shell,
        browserData: DATA,
        crewFolders: [SPARKS, WORKFLOWS],
      }),
    ),
  );
}

const run = (command: string, overrides: Partial<ApprovalRequest> = {}) =>
  decided(request({ command, title: command, ...overrides }));
const readTool = (target: string, overrides: Partial<ApprovalRequest> = {}) =>
  decided(
    request({ kind: 'other', toolKind: 'read', title: 'Read', paths: [target], ...overrides }),
  );
const editTool = (target: string, toolKind = 'edit') =>
  decided(request({ kind: 'edit', toolKind, title: 'Edit', paths: [target] }));

describe("reading the turn's own Spark folder", () => {
  it('never refuses the read tool there', async () => {
    for (const target of [OWN, `${OWN}/SPARK.md`, `${OWN}/skills/review/SKILL.md`]) {
      const verdicts = await readTool(target);
      expect(verdicts.some((verdict) => verdict.startsWith('refuse'))).toBe(false);
      expect(verdicts[2]).toBe('allow');
    }
  });

  it('runs a command that only reads there at once, in a mode that asks too', async () => {
    expect(await run(`cat ${OWN}/skills/review/SKILL.md`)).toEqual(['allow', 'allow', 'allow']);
    expect(await run(`ls ${OWN}/skills && head -5 ${OWN}/SPARK.md`)).toEqual([
      'allow',
      'allow',
      'allow',
    ]);
  });

  it('judges a script run from there like any command', async () => {
    const commands = [
      `python3 ${OWN}/skills/review/check.py --strict`,
      `bash ${OWN}/skills/review/run.sh`,
      `${OWN}/skills/review/run.sh src`,
      `cd ${OWN}/skills/review && ./run.sh`,
      `node ${OWN}/skills/review/report.mjs ${OWN}/skills/review/data.json`,
    ];
    for (const command of commands) {
      expect(await run(command), command).toEqual(['ask (the mode asks)', 'allow', 'allow']);
    }
  });

  it('lets a file be copied out of the folder', async () => {
    const verdicts = await run(`cp ${OWN}/skills/review/template.md ./REVIEW.md`);
    expect(verdicts).toEqual(['ask (the mode asks)', 'allow', 'allow']);
  });
});

describe('neighbours of the Spark folder stay closed', () => {
  it("refuses the read tool in another Spark's folder and in the workflows folder", async () => {
    expect(await readTool(`${OTHER}/SPARK.md`)).toEqual(Array(3).fill(OUTSIDE_READ));
    expect(await readTool(`${WORKFLOWS}/nightly.json`)).toEqual(Array(3).fill(OUTSIDE_READ));
    expect(await readTool(SPARKS)).toEqual(Array(3).fill(OUTSIDE_READ));
  });

  it("refuses the read tool in another chat's private folder", async () => {
    expect(await readTool(`${CHAT}/notes.md`)).toEqual(Array(3).fill(OUTSIDE_READ));
  });

  it("refuses Spark's rules file, by the read tool and by a command", async () => {
    const refused = Array(3).fill(`refuse (${SPARK_RULES_REASON})`);
    expect(await readTool(RULES_FILE)).toEqual(refused);
    expect(await run(`cat ${RULES_FILE}`)).toEqual(refused);
    expect(await readTool(RULES_FILE, { readable: [path.dirname(RULES_FILE)] })).toEqual(refused);
  });

  it("refuses Spark's browser data and database", async () => {
    const refused = Array(3).fill(`refuse (${BROWSER_DATA_REASON})`);
    expect(await readTool(`${DATA}/Partitions/work/Cookies`)).toEqual(refused);
    expect(await run(`cat ${DATA}/postgres-password`)).toEqual(refused);
    expect(await run(`ls ${DATA}`)).toEqual(refused);
  });

  it('opens nothing for a turn with no Spark', async () => {
    expect(await readTool(`${OWN}/SPARK.md`, { readable: [] })).toEqual(
      Array(3).fill(OUTSIDE_READ),
    );
    expect((await run(`cat ${OWN}/SPARK.md`, { readable: [] }))[0]).toBe('ask (the mode asks)');
  });

  it("does not run another Spark's reads at once", async () => {
    expect((await run(`cat ${OTHER}/SPARK.md`))[0]).toBe('ask (the mode asks)');
  });
});

describe('changing Spark and workflow folders is refused in every mode', () => {
  it.each(['edit', 'delete', 'move'])('refuses the %s tool', async (toolKind) => {
    for (const target of [`${OWN}/SPARK.md`, `${OTHER}/skills/a/SKILL.md`, `${WORKFLOWS}/a.json`]) {
      expect(await editTool(target, toolKind), target).toEqual(Array(3).fill(REFUSED));
    }
  });

  it.each([
    `echo hi > ${OWN}/SPARK.md`,
    `echo hi >> ${OWN}/skills/review/SKILL.md`,
    `cat > ${OWN}/skills/new/SKILL.md <<'EOF'\nname\nEOF`,
    `rm ${OWN}/SPARK.md`,
    `rm -rf ${OWN}`,
    `rm -rf ${SPARKS}`,
    `rm -rf ${DATA}/dev`,
    `mv ${OWN} /tmp/gone`,
    `mv ${DATA}/dev /tmp/gone`,
    `mv ${OWN}/skills/review ${OWN}/skills/renamed`,
    `cp ./evil.sh ${OWN}/skills/review/run.sh`,
    `cp -t ${OWN}/skills/review ./evil.sh`,
    `sed -i '' s/a/b/ ${OWN}/SPARK.md`,
    `tee ${OWN}/notes.md`,
    `touch ${OWN}/x`,
    `mkdir -p ${OWN}/skills/new`,
    `ln -s /etc ${OWN}/etc`,
    `chmod +x ${OWN}/skills/review/run.sh`,
    `cd ${OWN} && touch x`,
    `cd ${OWN} && git init`,
    `cd ${OWN}/skills && rm -rf review`,
    `python3 -c "open('${OWN}/SPARK.md', 'w').write('x')"`,
    `python3 ./tool.py ${OWN}/SPARK.md`,
    `git -C ${OWN} init`,
    `tar xf /tmp/a.tar -C ${OWN}`,
    `echo '{}' > ${WORKFLOWS}/nightly.json`,
    `rm ${WORKFLOWS}/nightly.json`,
    `F=${OWN}/SPARK.md; echo hi > $F`,
    `bash -c "echo hi > ${OWN}/SPARK.md"`,
    `python3 ${OWN}/skills/review/check.py > ${OWN}/out.txt`,
  ])('refuses %s', async (command) => {
    expect(await run(command)).toEqual(Array(3).fill(REFUSED));
  });

  it('refuses a relative change made from inside the folder', async () => {
    expect(await run('rm -rf skills', { cwd: OWN })).toEqual(Array(3).fill(REFUSED));
    expect(await run('echo hi > SPARK.md', { cwd: OWN })).toEqual(Array(3).fill(REFUSED));
  });

  it('does not mistake a write beside or above the folders for a change to them', async () => {
    for (const command of [`cp notes.txt ${DATA}/dev`, `touch ${DATA}/dev/x`, 'cp notes.txt /']) {
      const verdicts = await run(command);
      expect(verdicts, command).not.toContain(REFUSED);
    }
  });

  it('leaves commands that never name the folders alone', async () => {
    expect(await run('ls src')).toEqual(['allow', 'allow', 'allow']);
    expect((await run('rm -rf build'))[2]).toBe('allow');
  });
});

describe('Claude deny rules for the folders', () => {
  it('denies edits of each folder and everything under it', () => {
    expect(crewFolderRules([SPARKS, WORKFLOWS])).toEqual([
      `Edit(/${SPARKS})`,
      `Edit(/${SPARKS}/**)`,
      `Edit(/${WORKFLOWS})`,
      `Edit(/${WORKFLOWS}/**)`,
    ]);
  });
});
