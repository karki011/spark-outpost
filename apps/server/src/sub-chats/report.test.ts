import { describe, expect, it } from 'vitest';
import { NONE_STATED, REPORT_FOOTER } from '@spark-outpost/contracts';
import { buildReport, reportText, TURN_REASONS, type ReportFacts } from './report.ts';

const FACTS: ReportFacts = {
  status: 'ready_for_review',
  branch: 'spark/orders-api',
  committed: true,
  pushed: true,
  pullRequest: {
    number: 41,
    url: 'https://github.com/acme/shop/pull/41',
    state: 'open',
    checks: 'passing',
  },
};

const NO_BRANCH: ReportFacts = {
  status: 'done',
  branch: null,
  committed: false,
  pushed: false,
  pullRequest: null,
};

const REPLY = [
  'The endpoint is in.',
  '',
  'Changed: GET /orders returns total_cents.',
  'Two files.',
  '**Risks:** The old total field is gone.',
  '## Blockers:',
  'None',
].join('\n');

describe('a sub-chat’s report', () => {
  it('reads the three labelled sections from the reply', () => {
    const report = buildReport({ status: 'succeeded', reply: REPLY, error: null }, FACTS);
    expect(report).toMatchObject({
      status: 'ready_for_review',
      reason: null,
      changed: 'GET /orders returns total_cents.\nTwo files.',
      risks: 'The old total field is gone.',
      blockers: 'None',
      said: 'The endpoint is in.',
    });
  });

  it('ends a section at the next label, whatever it is, and keeps that text', () => {
    const reply = [
      'Changed: b.js exports B.',
      'Risks: None',
      'Blockers: None',
      'Verification: node -e printed B. I did not commit.',
    ].join('\n');
    const report = buildReport({ status: 'succeeded', reply, error: null }, FACTS);
    expect(report.blockers).toBe('None');
    expect(report.said).toBe('Verification: node -e printed B. I did not commit.');
    expect(reportText(report)).toContain(
      'Blockers: None\nAlso said: Verification: node -e printed B. I did not commit.',
    );
  });

  it('keeps what the reply says before, between and after the sections', () => {
    const reply = [
      'node --test passes: 1 test, 1 pass, 0 fail.',
      '',
      '**Changed:** a.test.js covers A.',
      '- a.test.js: one test',
      '### Notes',
      'Ran it twice.',
      'Risks: None',
      '',
      'Next steps: merge A first.',
      'Blockers:',
      'None',
    ].join('\n');
    const report = buildReport({ status: 'succeeded', reply, error: null }, FACTS);
    expect(report).toMatchObject({
      changed: 'a.test.js covers A.\n- a.test.js: one test',
      risks: 'None',
      blockers: 'None',
      said: [
        'node --test passes: 1 test, 1 pass, 0 fail.',
        '',
        '### Notes',
        'Ran it twice.',
        'Next steps: merge A first.',
      ].join('\n'),
    });
    expect(reportText(report)).toContain('node --test passes: 1 test, 1 pass, 0 fail.');
  });

  it('keeps the rest of a reply that has no section after its opening lines', () => {
    const lines = Array.from({ length: 9 }, (_, index) => `Line ${index + 1}.`);
    const report = buildReport(
      { status: 'succeeded', reply: lines.join('\n'), error: null },
      FACTS,
    );
    expect(report.changed).toBe(lines.slice(0, 6).join('\n'));
    expect(report.said).toBe(lines.slice(6).join('\n'));
  });

  it('adds a label written twice to the same section', () => {
    const reply = 'Changed: the page.\nRisks: None\nChanged: and its test.';
    const report = buildReport({ status: 'succeeded', reply, error: null }, FACTS);
    expect(report.changed).toBe('the page.\nand its test.');
    expect(report.said).toBe('');
  });

  it('takes branch, commit, push and pull request from Spark’s record, never the reply', () => {
    const boast = 'Changed: all of it.\nBranch and pull request: pushed, pull request #999 merged.';
    const report = buildReport({ status: 'succeeded', reply: boast, error: null }, NO_BRANCH);
    expect(report).toMatchObject({
      branch: null,
      committed: false,
      pushed: false,
      pullRequest: null,
    });
    expect(reportText(report)).toContain(
      'Branch and pull request: no branch · not committed · not pushed · no pull request',
    );
  });

  it('reads None stated for a missing section', () => {
    const report = buildReport(
      { status: 'succeeded', reply: 'Changed: the page.', error: null },
      FACTS,
    );
    expect(report.changed).toBe('the page.');
    expect(report.risks).toBe(NONE_STATED);
    expect(report.blockers).toBe(NONE_STATED);
  });

  it('uses the opening lines as Changed when the reply has no section', () => {
    const reply = ['Built the page.', '', 'It lists orders.', ...Array(9).fill('More.')].join('\n');
    const report = buildReport({ status: 'succeeded', reply, error: null }, FACTS);
    expect(report.changed.split('\n')).toHaveLength(6);
    expect(report.changed.startsWith('Built the page.\nIt lists orders.')).toBe(true);
    expect(report.risks).toBe(NONE_STATED);
  });

  it('reads None stated everywhere for an empty reply', () => {
    const report = buildReport({ status: 'succeeded', reply: '  ', error: null }, FACTS);
    expect([report.changed, report.risks, report.blockers]).toEqual([
      NONE_STATED,
      NONE_STATED,
      NONE_STATED,
    ]);
  });

  it('says Needs you with the reason for a failed, stopped or lost turn', () => {
    const failed = buildReport(
      { status: 'failed', reply: 'Changed: half of it.', error: 'The agent\ncrashed.' },
      FACTS,
    );
    expect(failed).toMatchObject({
      status: 'needs_you',
      reason: 'Its turn failed: The agent crashed.',
      changed: 'half of it.',
    });
    const stopped = buildReport({ status: 'cancelled', reply: '', error: null }, FACTS);
    expect(stopped).toMatchObject({ status: 'needs_you', reason: TURN_REASONS.stopped });
    expect(buildReport({ status: 'gone', reply: '', error: null }, FACTS).reason).toBe(
      TURN_REASONS.gone,
    );
    expect(buildReport({ status: 'failed', reply: '', error: null }, FACTS).reason).toBe(
      TURN_REASONS.failed,
    );
  });

  it('writes the fixed shape with the footer', () => {
    const text = reportText(buildReport({ status: 'succeeded', reply: REPLY, error: null }, FACTS));
    expect(text.split('\n')[0]).toBe('Status: Ready for review');
    expect(text).toContain(
      'Branch and pull request: branch spark/orders-api · committed · pushed · pull request #41 (open, checks passing) https://github.com/acme/shop/pull/41',
    );
    expect(text).toContain('Risks: The old total field is gone.');
    expect(text.endsWith(REPORT_FOOTER)).toBe(true);
    const failed = reportText(buildReport({ status: 'cancelled', reply: '', error: null }, FACTS));
    expect(failed.split('\n')[0]).toBe(`Status: Needs you (${TURN_REASONS.stopped})`);
  });
});
