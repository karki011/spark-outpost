import { beforeEach, describe, expect, it } from 'vitest';
import {
  CREW_EDIT_CONFLICT,
  SPARK_ACTION_OPTION,
  type Approval,
  type CrewEditAction,
  type Teammate,
} from '@spark-outpost/contracts';
import { auditCrewDenial } from '../src/crew/crew-edit-audit.ts';
import { CREW_EDIT_PROBLEMS } from '../src/crew/crew-edit-plan.ts';
import { crewSparksDir } from '../src/crew/folders.ts';
import { crewFileHash, readCrewFile, saveCrewFile } from '../src/crew/spark-folder.ts';
import { sparkFolder } from '../src/crew/spark-skills.ts';
import { workflowStore } from '../src/crew-flows/workflow-store.ts';
import { decideApproval } from '../src/persistence/approvals.ts';
import { macOnlyCard } from '../src/remote/policy.ts';
import { ASK_SPARK_REFUSALS, cardRefusal } from '../src/spark-mcp/actions/ask-spark-limits.ts';
import { crewTool } from '../src/spark-mcp/tools/crew-tool.ts';
import { newSpark } from './crew-workflow-support.ts';
import { NOTES_SKILL, useCrewTools } from './spark-crew-harness.ts';
import { answerCard, cardResult, pendingCard, type RecordedHooks } from './spark-mcp-support.ts';
import type { TestDb } from './support.ts';

const crew = useCrewTools();
const { call } = crew;
let t: TestDb;
let recorded: RecordedHooks;
let chat: { conversationId: string; runId: string };
let scout: Teammate;

beforeEach(() => {
  ({ t, recorded, chat, scout } = crew.state());
});

const skill = (name: string, description = 'Write release notes from merged pull requests') =>
  `---\nname: ${name}\ndescription: ${description}\n---\nSteps.\n`;

const edit = (args: Record<string, unknown>) => call('spark_crew_edit', args);
const read = (args: Record<string, unknown> = {}) => call('spark_crew', args);
const cardAction = (card: Approval) => card.payload.sparkAction as CrewEditAction;
const scoutFiles = async () =>
  (await sparkFolder(crewSparksDir(), scout.id)).files.map((file) => file.path);
const scoutFile = async (path: string) =>
  (await readCrewFile(crewSparksDir(), scout.id, path)).text;

async function cardCount(): Promise<number> {
  const { rows } = await t.db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM approvals WHERE kind = 'spark_action'`,
  );
  return rows[0]!.count;
}

async function crewAudits(): Promise<Record<string, unknown>[]> {
  const { rows } = await t.db.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM run_protocol_log WHERE run_id = $1 AND method = 'spark/crew_edit'
     ORDER BY seq`,
    [chat.runId],
  );
  return rows.map((row) => row.payload);
}

describe('spark_crew reads the crew at once', () => {
  it('lists every Spark with its skills and every workflow with its stages', async () => {
    const scribe = await newSpark(t, 'Scribe', { role: 'Writer', agentMode: 'plan' });
    await saveCrewFile(crewSparksDir(), scribe.id, {
      path: 'skills/notes/SKILL.md',
      text: skill('notes'),
      baseHash: null,
    });
    await workflowStore().save(
      {
        id: 'nightly',
        name: 'Nightly',
        steps: [
          {
            id: 'look',
            sparkId: scout.id,
            prompt: '',
            dependsOn: [],
            join: 'all',
            onFailure: 'stop',
          },
          {
            id: 'write',
            sparkId: scribe.id,
            prompt: '',
            dependsOn: ['look'],
            join: 'all',
            onFailure: 'stop',
          },
        ],
      },
      null,
      new Set([scout.id, scribe.id]),
    );
    const listed = (await read()).facts as {
      sparks: Record<string, unknown>[];
      workflows: Record<string, unknown>[];
    };
    expect(listed.sparks).toEqual([
      expect.objectContaining({ name: 'Scout', role: 'Code reviewer', skills: [] }),
      expect.objectContaining({
        name: 'Scribe',
        role: 'Writer',
        mode: 'plan',
        skills: [{ name: 'notes', description: 'Write release notes from merged pull requests' }],
      }),
    ]);
    expect(listed.workflows).toEqual([
      { id: 'nightly', name: 'Nightly', stages: [['look: Scout'], ['write: Scribe']] },
    ]);
    const one = (await read({ workflow: 'nightly' })).facts as {
      workflow: { steps: { spark: string }[] };
      hash: string;
    };
    expect(one.workflow.steps.map((step) => step.spark)).toEqual(['Scout', 'Scribe']);
    expect((await read({ workflow: 'missing' })).text).toContain('no workflow called missing');
  });

  it('reads a folder and one file, audits the file by path and size, and sets no send flag', async () => {
    const folder = (await read({ spark: 'scout' })).facts as { files: { path: string }[] };
    expect(folder.files.map((file) => file.path)).toEqual(['SPARK.md']);
    const file = (await read({ spark: scout.id, path: 'SPARK.md' })).facts;
    expect(file).toMatchObject({ text: 'Be brief.', hash: crewFileHash('Be brief.') });
    const audits = recorded.audited as { method: string; params: Record<string, unknown> }[];
    expect(audits.filter((entry) => entry.method === 'spark/crew_read')).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({ id: scout.id, path: 'SPARK.md', bytes: 9 }),
      }),
    ]);
    expect(JSON.stringify(audits)).not.toContain('Be brief.');
    expect(crewTool.privateData).toBeUndefined();
    expect((await read({ spark: 'Scout', path: 'nope.md' })).text).toContain('no file nope.md');
    expect((await read({ spark: 'Scout', path: '../x' })).isError).toBe(true);
  });
});

describe('spark_crew_edit always asks the user', () => {
  it.each(['bypassPermissions', 'auto', 'default'])(
    'shows a card for a new skill with its script in %s and writes nothing yet',
    async (mode) => {
      await crew.setRun(mode);
      expect((await edit(NOTES_SKILL)).facts.outcome).toBe('waiting_for_user');
      const card = await pendingCard(t);
      expect(card.title).toBe('Change the Scout Spark?');
      expect(card.options.map((option) => option.name)).toEqual(['Allow', 'Deny']);
      expect(cardAction(card).files).toEqual([
        {
          path: 'skills/notes/SKILL.md',
          change: 'new',
          before: null,
          after: skill('notes'),
          baseHash: null,
        },
        {
          path: 'skills/notes/run.sh',
          change: 'new',
          before: null,
          after: 'gh pr list --state merged\n',
          baseHash: null,
        },
      ]);
      expect(await scoutFiles()).toEqual(['SPARK.md']);
    },
  );

  it('stays with the user on the Mac: never a paired device, never Ask Spark', async () => {
    await edit(NOTES_SKILL);
    const card = await pendingCard(t);
    expect(macOnlyCard(card.payload)).toBe(true);
    const chatRow = { id: chat.conversationId, title: 'Chat', terminal: false };
    expect(cardRefusal(card, chatRow, null)).toBe(ASK_SPARK_REFUSALS.crew);
    expect(card.payload.sparkRequested).toBeUndefined();
  });

  it('writes every file after Allow and audits paths and sizes, never text', async () => {
    await edit(NOTES_SKILL);
    const card = await answerCard(t, SPARK_ACTION_OPTION.confirm);
    const done = await cardResult(t, card.id);
    expect(done.payload.sparkResult).toMatchObject({
      state: 'done',
      message: 'Changed the Scout Spark’s files: 2 new.',
    });
    expect(await scoutFiles()).toEqual([
      'SPARK.md',
      'skills/notes/SKILL.md',
      'skills/notes/run.sh',
    ]);
    expect((await sparkFolder(crewSparksDir(), scout.id)).skills.map((s) => s.name)).toEqual([
      'notes',
    ]);
    const logged = await crewAudits();
    expect(logged.at(-1)).toMatchObject({
      outcome: 'done',
      action: {
        target: 'spark',
        id: scout.id,
        files: [
          { path: 'skills/notes/SKILL.md', change: 'new', beforeBytes: null },
          { path: 'skills/notes/run.sh', change: 'new', afterBytes: 26 },
        ],
      },
    });
    expect(JSON.stringify([logged, recorded.audited])).not.toContain('gh pr list');
  });

  it('shows the text it replaces and the full new SPARK.md', async () => {
    const text = `Be thorough.\n${'Check every file.\n'.repeat(400)}`;
    await edit({ spark: 'Scout', files: [{ path: 'SPARK.md', text }] });
    expect(cardAction(await pendingCard(t)).files).toEqual([
      {
        path: 'SPARK.md',
        change: 'changed',
        before: 'Be brief.',
        after: text,
        baseHash: crewFileHash('Be brief.'),
      },
    ]);
  });

  it('returns problems to the agent without a card', async () => {
    const result = await edit({
      spark: 'Scout',
      files: [
        { path: '../SPARK.md', text: 'x' },
        { path: 'skills/notes/SKILL.md', text: skill('other') },
        { path: 'gone.txt', text: null },
      ],
    });
    expect(result.facts.outcome).toBe('problems');
    expect((result.facts.problems as { path: string }[]).map((p) => p.path)).toEqual([
      '../SPARK.md',
      'gone.txt',
      'skills/notes/SKILL.md',
    ]);
    const workflow = await edit({
      workflow: { id: 'nightly', name: 'Nightly', steps: [{ id: 'look', spark: 'Nobody' }] },
    });
    expect(workflow.facts).toMatchObject({
      outcome: 'problems',
      problems: [{ path: 'look', text: 'No Spark called Nobody. Sparks: Scout.' }],
    });
    expect(await cardCount()).toBe(0);
    expect((await edit({ spark: 'Scout' })).isError).toBe(true);
    expect((await edit({ spark: 'Nobody', files: NOTES_SKILL.files })).text).toContain(
      'No Spark called Nobody',
    );
    expect(
      (await edit({ spark: 'Scout', files: [{ path: 'SPARK.md', text: 'Be brief.' }] })).facts,
    ).toMatchObject({ outcome: 'unchanged' });
  });

  it('refuses the write when a file changed after the card was shown, and says so next time', async () => {
    await edit({
      spark: 'Scout',
      files: [{ path: 'SPARK.md', text: 'Be thorough.' }, ...NOTES_SKILL.files],
    });
    await saveCrewFile(crewSparksDir(), scout.id, {
      path: 'SPARK.md',
      text: 'Edited by hand.',
      baseHash: crewFileHash('Be brief.'),
    });
    const card = await answerCard(t, SPARK_ACTION_OPTION.confirm);
    const failed = (await cardResult(t, card.id)).payload.sparkResult!;
    expect(failed.state).toBe('failed');
    expect(failed.message).toContain(`${CREW_EDIT_CONFLICT}: SPARK.md. Spark changed nothing.`);
    expect(await scoutFile('SPARK.md')).toBe('Edited by hand.');
    expect(await scoutFiles()).toEqual(['SPARK.md']);
    expect((await crewAudits()).at(-1)).toMatchObject({ outcome: 'conflict' });
    const again = await edit({
      spark: 'Scout',
      files: [{ path: 'SPARK.md', text: 'Be thorough.' }],
    });
    expect(again.facts.lastAttempt).toContain(CREW_EDIT_CONFLICT);
    expect(cardAction(await pendingCard(t)).files[0]!.before).toBe('Edited by hand.');
  });

  it('writes nothing after Deny and audits the denial', async () => {
    await edit(NOTES_SKILL);
    const card = await pendingCard(t);
    const denied = await decideApproval(t.db, t.workspaceId, card.id, {
      optionId: SPARK_ACTION_OPTION.decline,
      scope: 'once',
    });
    await auditCrewDenial(t.db, denied);
    expect(denied.status).toBe('denied');
    expect(await scoutFiles()).toEqual(['SPARK.md']);
    expect((await crewAudits()).at(-1)).toMatchObject({
      outcome: 'denied',
      approvalId: card.id,
      action: { files: [{ path: 'skills/notes/SKILL.md' }, { path: 'skills/notes/run.sh' }] },
    });
  });

  it('deletes a file and a whole skill folder after Allow', async () => {
    for (const file of NOTES_SKILL.files) {
      await saveCrewFile(crewSparksDir(), scout.id, { ...file, baseHash: null });
    }
    await edit({ spark: 'Scout', remove: 'notes', files: [{ path: 'SPARK.md', text: null }] });
    const card = await pendingCard(t);
    expect(cardAction(card).files.map((file) => [file.path, file.change])).toEqual([
      ['SPARK.md', 'deleted'],
      ['skills/notes/SKILL.md', 'deleted'],
      ['skills/notes/run.sh', 'deleted'],
    ]);
    expect(cardAction(card).files[0]).toMatchObject({ before: 'Be brief.', after: null });
    await answerCard(t, SPARK_ACTION_OPTION.confirm);
    expect((await cardResult(t, card.id)).payload.sparkResult?.message).toBe(
      'Changed the Scout Spark’s files: 3 deleted.',
    );
    expect(await scoutFiles()).toEqual([]);
    expect((await edit({ spark: 'Scout', remove: 'notes' })).facts.problems).toEqual([
      { path: 'skills/notes', text: CREW_EDIT_PROBLEMS.noSkill },
    ]);
  });

  it('names similar skills and Sparks on the card', async () => {
    const scribe = await newSpark(t, 'Scribe', { role: 'Code reviewer', instructions: '' });
    await saveCrewFile(crewSparksDir(), scribe.id, {
      path: 'skills/release-notes/SKILL.md',
      text: skill('release-notes', 'Notes for a release'),
      baseHash: null,
    });
    await edit(NOTES_SKILL);
    const first = await pendingCard(t);
    expect(cardAction(first).similar).toEqual([
      { kind: 'skill', name: 'release-notes', spark: 'Scribe', reason: 'similar_name' },
    ]);
    await decideApproval(t.db, t.workspaceId, first.id, {
      optionId: SPARK_ACTION_OPTION.decline,
      scope: 'once',
    });
    const reviewer = await newSpark(t, 'Scouts', { instructions: '' });
    await edit({ spark: reviewer.id, files: [{ path: 'SPARK.md', text: 'Review code.' }] });
    expect(cardAction(await pendingCard(t)).similar).toEqual([
      { kind: 'spark', name: 'Scout', spark: null, reason: 'similar_name' },
    ]);
  });

  it('returns the waiting card for the same change asked twice', async () => {
    const first = await edit(NOTES_SKILL);
    const second = await edit(NOTES_SKILL);
    expect(second.facts).toMatchObject({
      outcome: 'waiting_for_user',
      approvalId: first.facts.approvalId,
    });
    expect(await cardCount()).toBe(1);
  });

  it('creates, changes and deletes a workflow, each on a card', async () => {
    const nightly = { id: 'nightly', name: 'Nightly', steps: [{ id: 'look', spark: 'Scout' }] };
    await edit({ workflow: nightly });
    const created = await pendingCard(t);
    expect(created.title).toBe('Change the Nightly workflow?');
    expect(cardAction(created)).toMatchObject({
      target: 'workflow',
      id: 'nightly',
      stages: [['Scout']],
      files: [{ path: 'nightly.json', change: 'new', before: null }],
    });
    expect(await workflowStore().read('nightly')).toBeNull();
    await answerCard(t, SPARK_ACTION_OPTION.confirm);
    expect((await cardResult(t, created.id)).payload.sparkResult?.message).toBe(
      'Created the Nightly workflow.',
    );
    expect((await workflowStore().read('nightly'))!.workflow.steps[0]!.sparkId).toBe(scout.id);

    await edit({ workflow: { ...nightly, name: 'Every night' } });
    const changed = await pendingCard(t);
    expect(cardAction(changed).files[0]).toMatchObject({ change: 'changed' });
    const current = await workflowStore().read('nightly');
    await workflowStore().save(
      { ...current!.workflow, name: 'By hand' },
      current!.hash,
      new Set([scout.id]),
    );
    await answerCard(t, SPARK_ACTION_OPTION.confirm);
    expect((await cardResult(t, changed.id)).payload.sparkResult).toMatchObject({
      state: 'failed',
    });
    expect((await workflowStore().read('nightly'))!.workflow.name).toBe('By hand');

    await edit({ remove: 'nightly' });
    const removed = await pendingCard(t);
    expect(cardAction(removed).files[0]).toMatchObject({ change: 'deleted', after: null });
    await answerCard(t, SPARK_ACTION_OPTION.confirm);
    expect((await cardResult(t, removed.id)).payload.sparkResult?.message).toBe(
      'Deleted the By hand workflow.',
    );
    expect(await workflowStore().read('nightly')).toBeNull();
  });
});
