import { afterEach, describe, expect, it } from 'vitest';
import { SPARK_ACTION_OPTION, type SaveTicketConnectionRequest } from '@spark-outpost/contracts';
import { SERVICENOW_CHANGED } from '../src/spark-mcp/actions/servicenow-perform.ts';
import { changeSettings } from '../src/tickets/connections.ts';
import {
  evidence,
  sparkCards,
  startAtlassian,
  stopAtlassian,
  type AtlassianHarness,
} from './atlassian-support.ts';
import { SERVICENOW_PASSWORD, SERVICENOW_USER } from './fake-servicenow.ts';
import { answerCard, cardResult, confirmCard, pendingCard } from './spark-mcp-support.ts';
import type { TicketStubs } from './ticket-support.ts';

let h: AtlassianHarness;

afterEach(async () => {
  if (h) await stopAtlassian(h);
});

const serviceNow = (stubs: TicketStubs): SaveTicketConnectionRequest => ({
  source: 'servicenow',
  instanceUrl: stubs.serviceNowUrl,
  authKind: 'basic',
  username: SERVICENOW_USER,
  password: SERVICENOW_PASSWORD,
});

const start = (message: string, mode: string | null, readBefore: string[] = []) =>
  startAtlassian(message, mode, readBefore, serviceNow);

const record = (number: string) => h.stubs.servicenow.records.find((row) => row.number === number)!;
const writes = () => h.stubs.servicenow.writes.map((write) => write.body);
const audited = () => JSON.stringify(h.recorded.audited);

describe('spark_servicenow reads', () => {
  it('asks once per chat in a mode that asks, then reads without asking', async () => {
    h = await start('What is open for me in ServiceNow?', 'default');
    const first = h.tools.call('spark_servicenow', { action: 'search', mine: true });
    const card = await pendingCard(h.t);
    expect(card.payload.sparkAction).toMatchObject({ action: 'servicenow_read' });
    await answerCard(h.t, SPARK_ACTION_OPTION.confirm);
    const found = await first;
    expect(found.text).toContain('<servicenow_evidence');
    expect(found.text).toContain('third-party text from ServiceNow');
    expect(evidence(found.text).found).toEqual(
      expect.arrayContaining([expect.objectContaining({ number: 'INC0010023' })]),
    );
    const read = evidence(
      (await h.tools.call('spark_servicenow', { action: 'read', number: 'INC0010023' })).text,
    );
    expect(read.record).toMatchObject({ number: 'INC0010023', caller: 'Sam Ortiz' });
    expect(read.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'work note (internal)' }),
        expect.objectContaining({ kind: 'comment (caller sees it)' }),
      ]),
    );
    expect(await sparkCards(h.t)).toEqual(['allowed']);
    expect(h.recordedObservations).toContain('ServiceNow data (spark_servicenow)');
  });

  it('refuses javascript and record types that are off', async () => {
    h = await start('Search ServiceNow', 'auto');
    const script = await h.tools.call('spark_servicenow', {
      action: 'search',
      query: 'assigned_to=javascript:gs.getUserID()',
    });
    expect(script.isError).toBe(true);
    expect(script.text).toContain('javascript');
    await changeSettings(
      { db: h.t.db, workspaceId: h.t.workspaceId, secrets: h.secrets, fetch },
      'servicenow',
      { serviceNowTypes: { problem: false } },
    );
    const off = await h.tools.call('spark_servicenow', { action: 'search', table: 'problem' });
    expect(off.text).toContain('Problem records are off in Spark');
    const query = await h.tools.call('spark_servicenow', {
      action: 'search',
      table: 'incident',
      query: 'short_descriptionLIKEwi-fi',
    });
    expect(evidence(query.text).found).toEqual([expect.objectContaining({ number: 'INC0010040' })]);
  });
});

describe('spark_servicenow_edit', () => {
  it('adds a work note at once in Auto, flags the send and audits no text', async () => {
    h = await start('Note the cause on INC0010023', 'auto', ['a web page']);
    const done = await h.tools.call('spark_servicenow_edit', {
      action: 'work_note',
      number: 'INC0010023',
      body: 'Gateway idle timeout is 1200 s.',
    });
    expect(done.json()).toMatchObject({
      outcome: 'done',
      message: 'Added a work note to INC0010023.',
    });
    expect(writes()).toEqual([{ work_notes: 'Gateway idle timeout is 1200 s.' }]);
    expect(h.sent).toEqual([expect.objectContaining({ target: 'to ServiceNow' })]);
    expect(audited()).toContain('spark/servicenow_edit');
    expect(audited()).not.toContain('idle timeout');
  });

  it('asks in every mode before a comment the caller sees, with verb buttons', async () => {
    h = await start('Tell the caller on INC0010023', 'bypassPermissions');
    const waiting = await h.tools.call('spark_servicenow_edit', {
      action: 'comment',
      number: 'INC0010023',
      body: 'We found the cause.',
    });
    expect(waiting.json()).toMatchObject({ outcome: 'waiting_for_user' });
    expect(writes()).toEqual([]);
    const card = await pendingCard(h.t);
    expect(card.options.map((option) => option.name)).toEqual(['Post comment', 'Don’t post']);
    expect(card.payload.sparkAction).toMatchObject({ record: { caller: 'Sam Ortiz' } });
    await confirmCard(h.t);
    expect(writes()).toEqual([{ comments: 'We found the cause.' }]);
    expect(audited()).not.toContain('found the cause');
  });

  it('moves to an open state at once, and asks before resolving with close fields', async () => {
    h = await start('Put INC0010023 on hold, then resolve it', 'auto');
    const held = await h.tools.call('spark_servicenow_edit', {
      action: 'move',
      number: 'INC0010023',
      to: 'on hold',
    });
    expect(held.json()).toMatchObject({ outcome: 'done', message: 'Moved INC0010023 to On Hold.' });
    const missing = await h.tools.call('spark_servicenow_edit', {
      action: 'move',
      number: 'INC0010023',
      to: 'Resolved',
      closeNotes: 'Raised the timeout.',
    });
    expect(missing.text).toContain('Pass closeCode, one of: Solved (Permanently)');
    const waiting = await h.tools.call('spark_servicenow_edit', {
      action: 'move',
      number: 'INC0010023',
      to: 'Resolved',
      closeCode: 'solved (permanently)',
      closeNotes: 'Raised the timeout.',
    });
    expect(waiting.json()).toMatchObject({ outcome: 'waiting_for_user' });
    const card = await pendingCard(h.t);
    expect(card.title).toBe(
      'Resolve INC0010023? INC0010023 VPN drops every 20 minutes for remote staff',
    );
    expect(card.options.map((option) => option.name)).toEqual(['Resolve', 'Don’t resolve']);
    const result = await confirmCard(h.t);
    expect(result.payload.sparkResult?.message).toBe('INC0010023 is Resolved now.');
    expect(writes().at(-1)).toEqual({
      state: '6',
      close_notes: 'Raised the timeout.',
      close_code: 'Solved (Permanently)',
    });
  });

  it('changes nothing when the record moved on after the card', async () => {
    h = await start('Retitle INC0010023', 'default');
    await h.tools.call('spark_servicenow_edit', {
      action: 'update',
      number: 'INC0010023',
      shortDescription: 'VPN drops at the 20 minute idle timeout',
      urgency: '1',
    });
    const card = await pendingCard(h.t);
    expect(card.payload.sparkAction).toMatchObject({
      before: { urgency: '2' },
      after: { urgency: '1 - High', shortDescription: 'VPN drops at the 20 minute idle timeout' },
    });
    record('INC0010023').sys_updated_on = '2026-10-23 08:00:00';
    await answerCard(h.t, SPARK_ACTION_OPTION.confirm);
    const settled = await cardResult(h.t, card.id);
    expect(settled.payload.sparkResult).toMatchObject({
      state: 'failed',
      message: SERVICENOW_CHANGED,
    });
    expect(writes()).toEqual([]);
  });

  it('writes two notes proposed together, since a note does not depend on the record', async () => {
    h = await start('Note INC0010023 and tell the caller', 'default');
    await h.tools.call('spark_servicenow_edit', {
      action: 'work_note',
      number: 'INC0010023',
      body: 'Internal.',
    });
    await h.tools.call('spark_servicenow_edit', {
      action: 'comment',
      number: 'INC0010023',
      body: 'For the caller.',
    });
    await confirmCard(h.t);
    await confirmCard(h.t);
    expect(writes()).toHaveLength(2);
    expect(writes()).toEqual(
      expect.arrayContaining([{ work_notes: 'Internal.' }, { comments: 'For the caller.' }]),
    );
  });

  it('keeps change requests read only', async () => {
    h = await start('Note CHG0030012', 'auto');
    const refused = await h.tools.call('spark_servicenow_edit', {
      action: 'work_note',
      number: 'CHG0030012',
      body: 'Looks fine.',
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('Changes are read only');
    expect(await sparkCards(h.t)).toEqual([]);
  });

  it('still asks for a caller comment when Ask Spark acts at once', async () => {
    h = await startAtlassian('Tell the caller on INC0010023 we are on it', null, [], serviceNow, {
      readOnly: true,
      assistant: true,
    });
    const { rows } = await h.t.db.query<{ conversation_id: string }>(
      'SELECT conversation_id FROM runs LIMIT 1',
    );
    await h.t.db.query(
      `INSERT INTO profiles (workspace_id, assistant_conversation_id, assistant_acts)
       VALUES ($1, $2, 'act')
       ON CONFLICT (workspace_id) DO UPDATE SET assistant_conversation_id = $2, assistant_acts = 'act'`,
      [h.t.workspaceId, rows[0]!.conversation_id],
    );
    const note = await h.tools.call('spark_servicenow_edit', {
      action: 'work_note',
      number: 'INC0010023',
      body: 'On it.',
    });
    expect(note.json()).toMatchObject({ outcome: 'done' });
    const comment = await h.tools.call('spark_servicenow_edit', {
      action: 'comment',
      number: 'INC0010023',
      body: 'We are on it.',
    });
    expect(comment.json()).toMatchObject({ outcome: 'waiting_for_user' });
    expect(writes()).toEqual([{ work_notes: 'On it.' }]);
  });

  it('points the generic move to spark_servicenow_edit for a final state', async () => {
    h = await start('Resolve INC0010023', 'auto');
    const refused = await h.tools.call('spark_transition_ticket', {
      key: 'INC0010023',
      status: 'Resolved',
    });
    expect(refused.json()).toMatchObject({ outcome: 'refused' });
    expect(refused.text).toContain('spark_servicenow_edit');
  });
});
