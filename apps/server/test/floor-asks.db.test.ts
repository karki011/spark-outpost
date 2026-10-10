import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GIT_CONTROL_REASON, INSTRUCTION_REASON } from '../src/approvals/decide.ts';
import { HOOK_APPEND, ORDINARY_COMMAND, ORDINARY_GIT, RULES_APPEND } from './fake-acp-floor.ts';
import { RULES, floorCard, floorRuns } from './floor-support.ts';

const { root, run, userCards, gateRecords, ranWithoutReview, railAudits } = floorRuns();

describe.each(['auto', 'bypassPermissions', 'acceptEdits'])(
  'the safety floor in %s, where the agent runs most tools without asking',
  { timeout: 120_000 },
  (mode) => {
    it('asks before the agent changes an instruction file', async () => {
      const { asked, detail, usedModes } = await run(mode, '#floorrules');
      expect(usedModes).toEqual([mode]);
      const cards = asked.filter(floorCard);
      expect(cards).toEqual([
        expect.objectContaining({
          kind: 'edit',
          reason: INSTRUCTION_REASON,
          payload: expect.objectContaining({ instructionFiles: ['AGENTS.md'] }),
        }),
      ]);
      expect(readFileSync(join(root(), 'AGENTS.md'), 'utf8')).toBe(RULES);
      expect((detail.railFlags ?? []).map((flag) => flag.rail)).toEqual([]);
    });

    it('asks with hold-to-confirm before the agent installs a git hook', async () => {
      const { asked } = await run(mode, '#floorhook');
      const cards = asked.filter(floorCard);
      expect(cards).toEqual([
        expect.objectContaining({
          kind: 'edit',
          reason: GIT_CONTROL_REASON,
          payload: expect.objectContaining({ gitControl: ['.git/hooks/pre-commit'] }),
        }),
      ]);
      expect(existsSync(join(root(), '.git/hooks/pre-commit'))).toBe(false);
    });
  },
);

describe.each(['auto', 'bypassPermissions'])(
  'ordinary work in %s',
  { timeout: 120_000 },
  (mode) => {
    it('raises no card and no flag for an edit, a command, a read and everyday git', async () => {
      const { conversationId, detail, status, usedModes } = await run(mode, '#floorordinary');
      expect([status, usedModes]).toEqual(['succeeded', [mode]]);
      expect(readFileSync(join(root(), 'notes.txt'), 'utf8')).toContain('changed\n');
      expect(await userCards(conversationId)).toEqual([]);
      expect(detail.railFlags ?? []).toEqual([]);
      expect(await ranWithoutReview(conversationId)).toEqual(
        expect.arrayContaining(['Edit notes.txt', ORDINARY_COMMAND, ...ORDINARY_GIT]),
      );
      expect(await gateRecords(conversationId)).toEqual([]);
    });
  },
);

describe.each(['auto', 'bypassPermissions', 'acceptEdits'])(
  'a shell command in %s that changes a protected file without a permission request',
  { timeout: 120_000 },
  (mode) => {
    it('is flagged afterwards with a card, a notice and an audit entry, and the run goes on', async () => {
      const { conversationId, detail, status } = await run(mode, '#floorshell');
      expect(status).toBe('succeeded');
      const flags = detail.railFlags ?? [];
      expect(flags.map((flag) => [flag.rail, flag.paths, flag.status]).sort()).toEqual([
        ['git_control', ['.git/hooks/pre-push'], 'open'],
        ['instructions', ['AGENTS.md'], 'open'],
      ]);
      expect(detail.conversation.attention).toMatchObject({ kind: 'flag' });
      expect(await railAudits(conversationId)).toEqual(['git_control', 'instructions']);
      expect(await userCards(conversationId)).toEqual([]);
      expect(await ranWithoutReview(conversationId)).toEqual(
        expect.arrayContaining([RULES_APPEND, HOOK_APPEND]),
      );
    });
  },
);
