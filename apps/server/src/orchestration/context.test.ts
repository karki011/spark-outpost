import { describe, expect, it } from 'vitest';
import {
  HISTORY_TURNS,
  ARCHITECT_NOTES_LIMIT,
  PATCH_LIMIT,
  architectNotes,
  architectPrompt,
  builderPrompt,
  checkFailureText,
  checkFixFollowUp,
  criticFollowUp,
  criticPrompt,
  namedFiles,
  readFiles,
} from './context.ts';
import { reviewFindings, reviewVerdict } from './review.ts';

const plan = [
  'Move parsing into src/dates.ts',
  'Update src/chat/divider.tsx to use it',
  'Add a test',
];

describe('context assembly', () => {
  it('gives the Architect the request, recent history and repo names, never full paths', () => {
    const history = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `turn ${index}`,
    }));
    const prompt = architectPrompt({
      request: 'Move date handling',
      history,
      repos: ['/Users/me/code/app'],
      previousPlan: [],
      note: null,
    });
    expect(prompt).toMatchInlineSnapshot(`
      "Role: Architect. You plan; you do not change files. Read the linked repos as needed.

      Record your plan with your plan or todo tool as 2 to 6 concrete, ordered steps. End each step with "Files: a.ts, b.ts" listing only the files that step creates or changes, not files it only reads or imports from. Then reply with a short summary of the plan.

      After the summary, list every step on its own line, numbered as in your plan, with the files it creates or changes and the earlier steps it needs, for example "Step 3 · Files: src/csv.ts, test/csv.test.ts · Depends on: 1" or "Step 1 · Files: src/a.ts · Depends on: none".

      Independent work runs at the same time, each chain in its own copy of the repo. If the steps form independent chains that change different files and need nothing from each other, name each chain on its own line, such as "Chain A: steps 1-3" and "Chain B: steps 4-6". A step that needs more than one chain comes after them and belongs to no chain. A step that only reads or researches starts with "Research:".

      A chain of one step only gets its own Builder when it takes more than about 20 seconds. Add a line such as "Large: 2, 3" naming the single steps you expect to take that long.

      Finally, write a "Notes for Builders:" line followed by what the Builders need so they do not re-read the files you read: exact signatures, import lines and short excerpts, each with its file path. Keep the notes under 3,000 characters.

      ## Request
      Move date handling

      ## Earlier conversation
      User: turn 4

      Assistant: turn 5

      User: turn 6

      Assistant: turn 7

      User: turn 8

      Assistant: turn 9

      ## Repos
      - app"
    `);
    expect(prompt.match(/turn \d/g)).toHaveLength(HISTORY_TURNS);
  });

  it('sends an edited plan back with the previous plan and your note', () => {
    const prompt = architectPrompt({
      request: 'r',
      history: [],
      repos: [],
      previousPlan: plan,
      note: 'Skip the test',
    });
    expect(prompt).toContain('## Your previous plan\n1. Move parsing into src/dates.ts');
    expect(prompt).toContain('## Change requested by the user\nSkip the test');
  });

  it('gives a Builder its step, the files it names and what earlier steps changed', () => {
    const prompt = builderPrompt({
      request: 'Move date handling',
      plan,
      stepIndex: 1,
      earlierChanges: [{ path: 'src/dates.ts', additions: 12, deletions: 3 }],
      note: null,
      findings: [],
    });
    expect(prompt).toMatchInlineSnapshot(`
      "Role: Builder. Make the change for your step only, then reply with what you changed.

      ## Request
      Move date handling

      ## Plan
      1. Move parsing into src/dates.ts
      2. Update src/chat/divider.tsx to use it  <- your step
      3. Add a test

      ## Your step
      Update src/chat/divider.tsx to use it

      ## Files the plan names
      - src/chat/divider.tsx

      ## Changed by earlier steps
      - src/dates.ts (+12 -3)"
    `);
  });

  it('gives one Builder every carried step with step markers and the Architect notes', () => {
    const prompt = builderPrompt({
      request: 'Move date handling',
      plan,
      stepIndex: 0,
      carry: [0, 1, 2],
      architectNotes: {
        files: ['dates.ts', 'divider.tsx'],
        text: 'src/dates.ts exports parseDate(text: string): Date.',
      },
      earlierChanges: [],
      note: null,
      findings: [],
    });
    expect(prompt).toMatchInlineSnapshot(`
      "Role: Builder. Make the changes for your steps in plan order, then reply with what you changed. When you finish a step, write "Step N done." on its own line, where N is its number in the plan.

      ## Request
      Move date handling

      ## Plan
      1. Move parsing into src/dates.ts  <- your step
      2. Update src/chat/divider.tsx to use it  <- your step
      3. Add a test  <- your step

      ## Your steps
      Step 1: Move parsing into src/dates.ts
      Step 2: Update src/chat/divider.tsx to use it
      Step 3: Add a test

      ## Files the plan names
      - src/dates.ts
      - src/chat/divider.tsx

      ## Notes from the Architect
      Files it read: dates.ts, divider.tsx

      src/dates.ts exports parseDate(text: string): Date.

      ## Changed by earlier steps
      No files changed yet."
    `);
  });

  it('takes the notes section of the Architect reply and the files it read, capped', () => {
    const reply =
      'Plan: three steps.\n\n**Notes for Builders:**\n- src/a.ts: export function a(): void\n\nParallel: 2, 3\nLarge: 2, 3';
    const tools = ['Read `a.ts`', 'Read `a.ts`', 'Grep `foo`', 'Read `b.ts` (1 - 40)'];
    expect(architectNotes(reply, readFiles(tools))).toEqual({
      files: ['a.ts', 'b.ts'],
      text: '- src/a.ts: export function a(): void',
    });
    expect(architectNotes('Just a summary.', [])).toEqual({ files: [], text: 'Just a summary.' });
    expect(architectNotes('', [])).toBeNull();
    const long = builderPrompt({
      request: 'r',
      plan,
      stepIndex: 0,
      architectNotes: { files: [], text: 'x'.repeat(ARCHITECT_NOTES_LIMIT * 2) },
      earlierChanges: [],
      note: null,
      findings: [],
    });
    expect(long).toContain(`[cut at ${ARCHITECT_NOTES_LIMIT} characters]`);
    expect(long.length).toBeLessThan(ARCHITECT_NOTES_LIMIT + 1_000);
  });

  it('gives a repair Builder the review findings and your note', () => {
    const prompt = builderPrompt({
      request: 'r',
      plan: [],
      stepIndex: 0,
      earlierChanges: [],
      note: 'Use UTC',
      findings: ['Missing test'],
    });
    expect(prompt).not.toContain('## Plan');
    expect(prompt).toContain('No files changed yet.');
    expect(prompt).toContain('## Review findings to address\n- Missing test');
    expect(prompt).toContain('## Note from the user\nUse UTC');
  });

  it('gives the Critic the request, plan, diff and check results, with the diff capped', () => {
    const prompt = criticPrompt({
      request: 'r',
      plan,
      changes: [{ path: 'a.ts', additions: 1, deletions: 0 }],
      patch: 'x'.repeat(PATCH_LIMIT + 10),
      checks: [],
    });
    expect(prompt).toContain('Verdict: looks good" or "Verdict: concerns"');
    expect(prompt).toContain(`[cut at ${PATCH_LIMIT} characters]`);
    expect(prompt).toContain('## Check results\nNo checks ran.');
    expect(prompt.length).toBeLessThan(PATCH_LIMIT + 2_000);
  });

  it('names the Builder whose change the Critic reviews and keeps follow-ups short', () => {
    const review = {
      changes: [{ path: 'src/csv.ts', additions: 3, deletions: 0 }],
      patch: '+export const csv = 1;',
      checks: ['- `npm test` passed'],
      subject: { name: 'Rivet', steps: [3, 4] },
    };
    const prompt = criticPrompt({ request: 'r', plan, ...review });
    expect(prompt).toContain(
      "## Change under review\nRivet's change for steps 4, 5. Other Builders may still be working; review only this diff.",
    );
    const followUp = criticFollowUp(review);
    expect(followUp.startsWith('Review the next change the same way')).toBe(true);
    expect(followUp).not.toContain('## Request');
    expect(followUp).toContain('## Check results\n- `npm test` passed');
  });

  it('marks own steps on their first line when steps carry a Files line', () => {
    const prompt = builderPrompt({
      request: 'r',
      plan: ['Add csv\nFiles: src/csv.ts', 'Add tests\nFiles: test/csv.test.ts'],
      stepIndex: 1,
      earlierChanges: [],
      note: null,
      findings: [],
    });
    expect(prompt).toContain(
      '1. Add csv\n   Files: src/csv.ts\n2. Add tests  <- your step\n   Files: test/csv.test.ts',
    );
  });

  it('turns failing checks into a short fix request with the end of each output', () => {
    const failures = checkFailureText([
      { command: 'npm test', outcome: 'failed', exitCode: 1, outputTail: `${'x'.repeat(5000)}END` },
      { command: 'npm run lint', outcome: 'timed_out', exitCode: null, outputTail: '' },
    ]);
    expect(failures).toContain('`npm test` exited 1:');
    expect(failures).toContain('END');
    expect(failures).toContain('`npm run lint` timed out:\n```text\n(no output)\n```');
    expect(failures.length).toBeLessThan(3_200);
    const followUp = checkFixFollowUp(failures);
    expect(followUp.startsWith("Role: Builder. The project's checks failed")).toBe(true);
    expect(followUp).toContain('## Failing checks\n`npm test` exited 1:');
  });

  it('finds the files a plan names', () => {
    expect(namedFiles(['Edit `src/a.ts` and README.md', 'no files here'])).toEqual([
      'src/a.ts',
      'README.md',
    ]);
    expect(namedFiles(['Move it into src/b.ts. Then update src/c.ts.'])).toEqual([
      'src/b.ts',
      'src/c.ts',
    ]);
  });
});

describe('review parsing', () => {
  it('reads the last verdict line and the findings', () => {
    const text = 'Looks mostly fine.\nFindings:\n- Missing test\n- Typo in name\nVerdict: concerns';
    expect(reviewVerdict(text)).toBe('concerns');
    expect(reviewFindings(text)).toEqual(['Missing test', 'Typo in name']);
    expect(reviewVerdict('**Verdict:** looks good')).toBe('looks_good');
    expect(reviewVerdict('I think it is fine')).toBe('unclear');
  });
});
