import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sparkAvailability } from '../src/spark-mcp/availability.ts';
import type { SparkToolDeps } from '../src/spark-mcp/deps.ts';
import { CALENDAR_HOW_TO } from '../src/spark-mcp/tools/calendar/offered.ts';
import { assistantRun, assistantSetup, setActs } from './ask-spark-support.ts';
import { CalendarHarness } from './spark-calendar-support.ts';
import { toolDeps } from './spark-mcp-support.ts';
import { startChat } from './support.ts';

const ASK = { readOnly: true, assistant: true } as const;

let h: CalendarHarness;
let assistant: string;

beforeEach(async () => {
  h = await CalendarHarness.create();
  assistant = await assistantSetup(h.t);
});

afterEach(async () => {
  await h.close();
});

async function askSpark(question = 'What do I have in my calendar tomorrow?', source = 'ui') {
  h.chat = {
    conversationId: assistant,
    runId: await assistantRun(h.t, assistant, question, source),
  };
}

const deps = (overrides: Partial<SparkToolDeps> = {}) =>
  toolDeps(h.t, { calendar: { host: h.fake, google: null }, ...overrides });

const askScope = () => ({ workspaceId: h.t.workspaceId, ...h.chat, ...ASK });

describe('the calendar tools Ask Spark gets', () => {
  it('reads tomorrow for Ask Spark in Act, as a chat in Auto does', async () => {
    await setActs(h.t, 'act');
    await askSpark();
    await h.start({ scope: ASK });
    expect(await h.toolNames()).toEqual(['spark_calendar', 'spark_calendar_edit']);
    const read = await h.read();
    expect(read.result.isError).not.toBe(true);
    expect(JSON.stringify(read.facts)).toContain('Standup');
    expect(h.audited()[0]).toMatchObject({ tool: 'spark_calendar', decision: 'mode' });
  });

  it('asks on a card first in Manual, then reads once the user allows it', async () => {
    await askSpark();
    await h.start({ scope: ASK });
    const pending = h.read();
    await expect.poll(async () => (await h.cards()).length).toBe(1);
    await h.answer('confirm');
    const read = await pending;
    expect(JSON.stringify(read.facts)).toContain('Standup');
    expect(await h.cards()).toEqual([
      { action: 'calendar_read', status: 'allowed', decidedBy: 'user' },
    ]);
  });

  it('offers no reader with the switch off, and names the switch and where it is', async () => {
    await askSpark();
    await h.connect({ agentsRead: false });
    const available = await sparkAvailability(deps(), askScope());
    expect(available.calendar_read).toBe(false);
    expect(available.howTo?.calendar_read).toBe(CALENDAR_HOW_TO.read);
    expect(CALENDAR_HOW_TO.read).toContain(
      'Let agents read my calendar on the Calendar card in Settings → Connectors → Calendar',
    );
  });

  it('says to connect a calendar when none is connected', async () => {
    await askSpark();
    const available = await sparkAvailability(deps(), askScope());
    expect(available.calendar_read).toBe(false);
    expect(available.howTo?.calendar_read).toBe(CALENDAR_HOW_TO.connect);
  });

  it('gives Ask Spark the editor while a read-only chat turn gets none', async () => {
    await askSpark();
    await h.connect();
    expect((await sparkAvailability(deps(), askScope())).calendar_edit).toBe(true);
    const chat = await startChat(h.t, 'What is on today?');
    const readOnlyChat = { workspaceId: h.t.workspaceId, ...chat, readOnly: true };
    expect(await sparkAvailability(deps(), readOnlyChat)).toMatchObject({
      calendar_read: true,
      calendar_edit: false,
    });
  });

  it('gives an Ask Spark question from a paired device no calendar tools', async () => {
    await askSpark();
    await h.connect();
    await h.t.db.query('UPDATE runs SET remote_device_id = $2 WHERE id = $1', [
      h.chat.runId,
      randomUUID(),
    ]);
    const available = await sparkAvailability(deps(), askScope());
    expect(available).toMatchObject({ calendar_read: false, calendar_edit: false });
    expect(available.howTo?.calendar_read).toBe(CALENDAR_HOW_TO.remote);
  });
});

describe('the other Spark tools Ask Spark gets', () => {
  const macOn = () =>
    h.t.db.query('UPDATE profiles SET mac_control = true WHERE workspace_id = $1', [
      h.t.workspaceId,
    ]);
  const mac = { mac: {} as NonNullable<SparkToolDeps['mac']> };

  it('offers Mac control to a typed question, never a spoken one, and names the switch', async () => {
    await askSpark('What app is in front?');
    const off = await sparkAvailability(deps(mac), askScope());
    expect(off.mac).toBe(false);
    expect(off.howTo?.mac).toContain('Let agents control other Mac apps in Settings → Mac control');
    await macOn();
    expect((await sparkAvailability(deps(mac), askScope())).mac).toBe(true);
    await askSpark('What app is in front?', 'voice');
    const spoken = await sparkAvailability(deps(mac), askScope());
    expect(spoken.mac).toBe(false);
    expect(spoken.howTo?.mac).toContain('spoken');
  });

  it('reads any project for Ask Spark but never publishes', async () => {
    await askSpark('Which pull requests are open in app?');
    await h.t.db.query(
      `INSERT INTO projects (id, workspace_id, name, root_path) VALUES ($1, $2, 'app', '/repo')`,
      [randomUUID(), h.t.workspaceId],
    );
    const gh = {
      locateGh: async () => '/usr/bin/gh',
      runCommand: async () => ({ code: 0, stdout: 'Logged in to github.com', stderr: '' }),
    };
    expect(await sparkAvailability(deps({ github: gh }), askScope())).toMatchObject({
      project: true,
      pull_requests: true,
      publish: false,
      pull_request_create: false,
    });
  });
});
