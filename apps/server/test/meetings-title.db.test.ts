import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MEETING_UNTITLED, type AppEvent, type NewMeetingLine } from '@spark-outpost/contracts';
import { writeMeetingNotes, type NotesDeps } from '../src/meetings/notes.ts';
import { NotesModelError, type NotesModel } from '../src/meetings/notes-model.ts';
import { AUTO_TITLE_MAX, TITLE_RULES, cleanTitle } from '../src/meetings/notes-prompt.ts';
import {
  appendLines,
  createMeeting,
  endMeeting,
  getMeeting,
  getNotes,
  patchMeeting,
} from '../src/meetings/store.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

const LINES: NewMeetingLine[] = [
  { speaker: 'you', text: 'Let us pick the launch date', startMs: 0, endMs: 900 },
  { speaker: 'others', text: 'The ninth works', startMs: 1000, endMs: 1900 },
];

interface TitleModel extends NotesModel {
  prompts: string[];
}

function modelWith(title: (prompt: string) => string | Promise<string>): TitleModel {
  const prompts: string[] = [];
  return {
    prompts,
    available: async () => true,
    async complete(prompt) {
      prompts.push(prompt);
      const text = prompt.startsWith(TITLE_RULES)
        ? await title(prompt)
        : '## Summary\nLaunch on the ninth.';
      return { text, runId: null };
    },
  };
}

function depsFor(model: NotesModel, events: AppEvent[] = []): NotesDeps {
  return {
    db: t.db,
    workspaceId: t.workspaceId,
    model,
    publish: async (event) => {
      events.push(event);
    },
  };
}

async function endedMeeting(request: { title?: string; eventKey?: string } = {}) {
  const meeting = await createMeeting(t.db, t.workspaceId, request);
  await appendLines(t.db, t.workspaceId, meeting.id, LINES);
  await endMeeting(t.db, t.workspaceId, meeting.id);
  return meeting.id;
}

async function titleOf(id: string) {
  return (await getMeeting(t.db, t.workspaceId, id))!.title;
}

describe('a title written after the notes', () => {
  it('replaces Untitled meeting from the written notes and announces it', async () => {
    const id = await endedMeeting();
    expect(await titleOf(id)).toBe(MEETING_UNTITLED);
    const model = modelWith(() => '"Launch date planning."\n\nExtra line');
    const events: AppEvent[] = [];
    await writeMeetingNotes(depsFor(model, events), id);
    expect(await titleOf(id)).toBe('Launch date planning');
    expect(model.prompts).toHaveLength(2);
    expect(model.prompts[1]).toContain('<notes>\n## Summary\nLaunch on the ninth.\n</notes>');
    expect((await getMeeting(t.db, t.workspaceId, id))!.notesState).toBe('ready');
    expect(events).toHaveLength(3);
  });

  it('asks for no title when the meeting was started with one', async () => {
    const id = await endedMeeting({
      title: 'Weekly sync',
      eventKey: 'cal|event@2026-11-12T10:00:00Z',
    });
    const model = modelWith(() => 'Something else');
    await writeMeetingNotes(depsFor(model), id);
    expect(model.prompts).toHaveLength(1);
    expect(await titleOf(id)).toBe('Weekly sync');
  });

  it('asks for no title once the user has typed one', async () => {
    const id = await endedMeeting();
    await patchMeeting(t.db, t.workspaceId, id, { title: 'My own title' });
    const model = modelWith(() => 'Something else');
    await writeMeetingNotes(depsFor(model), id);
    expect(model.prompts).toHaveLength(1);
    expect(await titleOf(id)).toBe('My own title');
  });

  it('keeps a title the user typed while the model was still writing one', async () => {
    const id = await endedMeeting();
    const model = modelWith(async () => {
      await patchMeeting(t.db, t.workspaceId, id, { title: 'Typed meanwhile' });
      return 'Model title';
    });
    await writeMeetingNotes(depsFor(model), id);
    expect(await titleOf(id)).toBe('Typed meanwhile');
  });

  it('titles once, so Write again leaves the title alone', async () => {
    const id = await endedMeeting();
    let call = 0;
    const model = modelWith(() => `Title ${(call += 1)}`);
    await writeMeetingNotes(depsFor(model), id);
    await writeMeetingNotes(depsFor(model), id);
    expect(await titleOf(id)).toBe('Title 1');
    expect(model.prompts).toHaveLength(3);
  });

  it('keeps the notes and the old title when the title call fails or is empty', async () => {
    const failing = await endedMeeting();
    await writeMeetingNotes(
      depsFor(
        modelWith(() => {
          throw new NotesModelError('no');
        }),
      ),
      failing,
    );
    expect(await titleOf(failing)).toBe(MEETING_UNTITLED);
    expect((await getNotes(t.db, failing))!.markdown).toContain('Launch on the ninth.');
    expect((await getMeeting(t.db, t.workspaceId, failing))!.notesState).toBe('ready');
    const empty = await endedMeeting();
    await writeMeetingNotes(depsFor(modelWith(() => '  \n')), empty);
    expect(await titleOf(empty)).toBe(MEETING_UNTITLED);
  });

  it('does not title a patch that leaves the title out', async () => {
    const id = await endedMeeting();
    await patchMeeting(t.db, t.workspaceId, id, { goal: 'Pick a date' });
    await writeMeetingNotes(depsFor(modelWith(() => 'Launch planning')), id);
    expect(await titleOf(id)).toBe('Launch planning');
  });
});

describe('cleaning a model title', () => {
  it('takes the first line without quotes, Markdown or a final stop', () => {
    expect(cleanTitle('\n## **Pricing** review.\nmore')).toBe('Pricing review');
    expect(cleanTitle('Title: “Roadmap check-in”')).toBe('Roadmap check-in');
    expect(cleanTitle('   ')).toBeNull();
    expect(cleanTitle('""')).toBeNull();
  });

  it('cuts a long reply', () => {
    const cut = cleanTitle('word '.repeat(60))!;
    expect(cut.length).toBeLessThanOrEqual(AUTO_TITLE_MAX);
    expect(cut.endsWith('…')).toBe(true);
  });
});
