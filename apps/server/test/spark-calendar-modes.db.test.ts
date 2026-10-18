import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CalendarHarness, MODES, PLANNING, STANDUP, tomorrowAt } from './spark-calendar-support.ts';

let h: CalendarHarness;

beforeEach(async () => {
  h = await CalendarHarness.create();
});

afterEach(async () => {
  await h.close();
});

describe('reading follows the mode the user picked', () => {
  for (const [provider, mode, name, asks] of MODES) {
    it(`${name} ${asks ? 'asks once for the chat' : 'reads at once'}`, async () => {
      await h.start({ mode, provider });
      const reading = h.read();
      if (asks) {
        const card = await h.pending();
        expect(card.payload.sparkAction).toMatchObject({ action: 'calendar_read' });
        await h.answer('confirm');
      }
      const read = await reading;
      expect(read.text.startsWith('<calendar_evidence')).toBe(true);
      const titles = (read.facts.events as { title: string }[]).map((event) => event.title);
      expect(titles).toEqual(['Standup', 'Planning', 'Pickup']);
      const again = await h.read({ action: 'calendars' });
      expect(again.result.isError).toBeFalsy();
      expect((await h.cards()).map((card) => card.action)).toEqual(asks ? ['calendar_read'] : []);
      expect(h.audited().map((entry) => entry.decision)).toEqual(
        asks ? ['user_allowed', 'allowed_earlier'] : ['mode', 'mode'],
      );
    });
  }

  it('reads at once in Accept edits when the user asked about the calendar', async () => {
    await h.start({ mode: 'acceptEdits', message: "What's on my calendar tomorrow?" });
    const read = await h.read();
    expect(read.facts.events).toHaveLength(3);
    expect(await h.cards()).toEqual([]);
  });

  it('a declined read gives the agent no events', async () => {
    await h.start({ mode: 'default' });
    const reading = h.read();
    await h.answer('decline');
    const read = await reading;
    expect(read.facts).toMatchObject({ outcome: 'declined' });
    expect(read.facts.events).toBeUndefined();
  });
});

describe('a change to the user’s own event follows the mode', () => {
  for (const [provider, mode, name, asks] of MODES.filter(([, mode]) => mode !== 'read-only')) {
    it(`${name} ${asks ? 'shows the before and after card' : 'moves it at once'}`, async () => {
      await h.start({ mode, provider });
      const moving = h.edit({
        action: 'update',
        calendar: await h.key('work-1'),
        eventId: PLANNING.id,
        occurrence: PLANNING.start,
        start: tomorrowAt(17),
      });
      if (asks) {
        const card = await h.pending();
        expect(card.payload.sparkAction).toMatchObject({
          action: 'calendar_edit',
          op: 'update',
          before: { title: 'Planning', start: PLANNING.start },
          after: { title: 'Planning', start: tomorrowAt(17), end: tomorrowAt(17, 30) },
          floor: [],
        });
        await h.answer('confirm');
        const result = await moving;
        expect(result.facts.outcome).toBe('waiting_for_user');
        await expect.poll(() => h.fake.writes.length).toBe(1);
      } else {
        expect((await moving).facts.outcome).toBe('done');
      }
      expect(h.fake.writes[0]).toMatchObject({
        op: 'save',
        calendarId: 'work-1',
        eventId: PLANNING.id,
        fields: { start: tomorrowAt(17), end: tomorrowAt(17, 30) },
        span: 'this',
      });
      const [card] = await h.cards();
      expect(card).toMatchObject({ action: 'calendar_edit', decidedBy: asks ? 'user' : 'level' });
    });
  }

  it('creates at once in Accept edits when the user asked for it', async () => {
    await h.start({ mode: 'acceptEdits', message: 'Add a Spark 1b test event tomorrow at 15:00' });
    const created = await h.edit({
      action: 'create',
      calendar: await h.key('work-1'),
      title: 'Spark 1b test',
      start: tomorrowAt(15),
      end: tomorrowAt(16),
      alarmMinutes: 10,
    });
    expect(created.facts.outcome).toBe('done');
    expect(h.fake.writes[0]).toMatchObject({
      op: 'save',
      calendarId: 'work-1',
      fields: { title: 'Spark 1b test', alarmMinutes: 10 },
    });
  });

  it('gives Ask turns no edit tool at all', async () => {
    await h.start({ mode: 'auto', scope: { readOnly: true } });
    expect(await h.toolNames()).toEqual(['spark_calendar']);
  });
});

const FLOOR_MODES = MODES.filter(([, , , asks]) => !asks);

describe('the floor asks in every mode', () => {
  for (const [provider, mode, name] of FLOOR_MODES) {
    it(`asks before a delete in ${name}`, async () => {
      await h.start({ mode, provider });
      const deleting = await h.edit({
        action: 'delete',
        calendar: await h.key('work-1'),
        eventId: PLANNING.id,
        occurrence: PLANNING.start,
      });
      expect(deleting.facts.outcome).toBe('waiting_for_user');
      const card = await h.pending();
      expect(card.payload.sparkAction).toMatchObject({ op: 'delete', floor: ['delete'] });
      expect(h.fake.writes).toEqual([]);
      await h.answer('confirm');
      await expect.poll(() => h.fake.writes.map((write) => write.op)).toEqual(['remove']);
    });

    it(`asks before changing an event with other people in ${name}`, async () => {
      await h.start({ mode, provider });
      const renaming = await h.edit({
        action: 'update',
        calendar: await h.key('work-1'),
        eventId: STANDUP.id,
        occurrence: STANDUP.start,
        title: 'Standup moved',
      });
      expect(renaming.facts.outcome).toBe('waiting_for_user');
      const card = await h.pending();
      expect(card.payload.sparkAction).toMatchObject({
        floor: ['others'],
        before: { others: 1 },
      });
      expect(h.fake.writes).toEqual([]);
    });

    it(`asks before any write on a shared or unclassified calendar in ${name}`, async () => {
      await h.start({ mode, provider });
      const adding = await h.edit({
        action: 'create',
        calendar: await h.key('fam-1'),
        title: 'Dentist',
        start: tomorrowAt(11),
        end: tomorrowAt(12),
      });
      expect(adding.facts.outcome).toBe('waiting_for_user');
      const card = await h.pending();
      expect(card.payload.sparkAction).toMatchObject({
        op: 'create',
        floor: ['shared'],
        calendar: { synced: true },
      });
      expect(h.fake.writes).toEqual([]);
    });
  }
});
