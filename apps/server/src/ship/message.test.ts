import { describe, expect, it } from 'vitest';
import type { PlanDocument } from '@spark-outpost/contracts';
import {
  commitBody,
  commitSubject,
  pullRequestBody,
  SHIP_FOOTER,
  type ShipSummary,
} from './message.ts';

const plan: PlanDocument = {
  id: '00000000-0000-4000-8000-000000000001',
  conversationId: '00000000-0000-4000-8000-000000000002',
  taskId: null,
  version: 2,
  status: 'approved',
  source: 'chat',
  body: 'Goal: tidy the notes\n\n1. Sort the lines\n2. Drop duplicates',
  sourceRunId: null,
  sourceMessageId: null,
  approvedAt: '2026-09-28T10:00:00.000Z',
  approvedBy: 'user',
  approvedOption: null,
  approvedCommit: null,
  createdAt: '2026-09-28T09:00:00.000Z',
};

const summary: ShipSummary = {
  title: 'Tidy the notes',
  summary: 'Sorted the notes and removed duplicate lines.',
  files: [
    { path: 'notes.txt', change: 'modified' },
    { path: 'docs/new.md', change: 'added' },
  ],
  checks: ['Checks for Bolt: tests passed'],
  review: {
    verdict: 'concerns',
    findings: ['Sorting drops the header line.'],
    sameProvider: false,
  },
  costUsd: 0.1234,
  costEstimated: true,
  plan,
};

describe('ship messages', () => {
  it('writes a PR body with summary, files, checks, findings, plan, cost and footer', () => {
    const body = pullRequestBody(summary);
    expect(body).toContain('## Summary\nSorted the notes and removed duplicate lines.');
    expect(body).toContain('- `notes.txt` (modified)\n- `docs/new.md` (added)');
    expect(body).toContain('## Checks\n- Checks for Bolt: tests passed');
    expect(body).toContain(
      '## Critic findings\nAI review has concerns\n- Sorting drops the header line.',
    );
    expect(body).toContain('Plan v2, approved 2026-09-28.\nGoal: tidy the notes');
    expect(body).toContain('- Sort the lines');
    expect(body).toContain('Cost: ~$0.12 (estimated)');
    expect(body.endsWith(SHIP_FOOTER)).toBe(true);
  });

  it('quotes each multi-line note whole, with only its first line in bold (B8)', () => {
    const body = pullRequestBody({
      ...summary,
      notes: [
        'Clarifying questions (no answer, went with the defaults):\n- Which rounding? → nearest\n- Keep the old name? → yes',
        'Plan it followed:\n\n1. Add the CLI\n2. Add tests',
      ],
    });
    expect(
      body.startsWith(
        [
          '> **Clarifying questions (no answer, went with the defaults):**',
          '> - Which rounding? → nearest',
          '> - Keep the old name? → yes',
          '',
          '> **Plan it followed:**',
          '>',
          '> 1. Add the CLI',
          '> 2. Add tests',
          '',
          '## Summary',
        ].join('\n'),
      ),
    ).toBe(true);
  });

  it('says when no checks ran and skips empty sections', () => {
    const body = pullRequestBody({
      ...summary,
      summary: null,
      checks: [],
      review: null,
      plan: null,
      costUsd: null,
    });
    expect(body).toContain('## Summary\nTidy the notes');
    expect(body).toContain('No project checks ran.');
    expect(body).not.toContain('Critic');
    expect(body).not.toContain('Agreed plan');
    expect(body).not.toContain('Cost');
    expect(body).not.toContain('Core impact');
  });

  it('highlights Core areas and key files the change touches, after the file list', () => {
    const body = pullRequestBody({
      ...summary,
      coreImpact: {
        areas: [
          { id: 'a1', name: 'Auth', files: 2 },
          { id: 'a2', name: 'Persistence', files: 1 },
        ],
        keyFiles: ['server/db.ts'],
      },
    });
    expect(body).toContain(
      [
        '## Core impact',
        'Touches Core: Auth (2 files), Persistence (1 file).',
        'Key files: `server/db.ts`',
        'Highlighted from the project map for review; no extra approval was needed.',
      ].join('\n'),
    );
    expect(body.indexOf('## Core impact')).toBeGreaterThan(body.indexOf('## Changed files'));
    expect(body.indexOf('## Core impact')).toBeLessThan(body.indexOf('## Checks'));
  });

  it('keeps the commit subject short and puts checks and review notes in the body', () => {
    expect(commitSubject(`Refactor ${'the very long module name '.repeat(5)}`).length).toBe(72);
    const body = commitBody(summary);
    expect(body).toContain('Checks: Checks for Bolt');
    expect(body).toContain('Review: AI review has concerns\n- Sorting drops the header line.');
    expect(body.endsWith(SHIP_FOOTER)).toBe(true);
  });
});
