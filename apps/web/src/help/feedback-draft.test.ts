import { describe, expect, it } from 'vitest';
import {
  draftKind,
  feedbackBody,
  feedbackDraft,
  feedbackTitle,
  fileName,
} from './feedback-draft.ts';
import { feedbackTarget } from './feedback-target.ts';

const report = {
  happened: 'The Ship button stayed busy\nafter the checks passed.',
  expected: 'A pull request link.',
  version: '0.1.0-beta.1',
  beta: true,
  diagnostics: 'spark-outpost-diagnostics-2026-10-01-120000.zip',
};

describe('feedbackDraft', () => {
  it('prefers a prefilled GitHub issue when a repo is set', () => {
    const draft = feedbackDraft({ email: 'beta@example.com', repo: 'acme/spark-beta' }, report);
    expect(draft.kind).toBe('github');
    if (draft.kind !== 'github') return;
    const url = new URL(draft.url);
    expect(url.origin + url.pathname).toBe('https://github.com/acme/spark-beta/issues/new');
    expect(url.searchParams.get('title')).toBe('Beta feedback: The Ship button stayed busy');
    expect(url.searchParams.get('body')).toBe(draft.body);
  });

  it('writes an email draft to the feedback address', () => {
    const draft = feedbackDraft({ email: 'beta@example.com', repo: '' }, report);
    expect(draft.kind).toBe('email');
    if (draft.kind !== 'email') return;
    expect(draft.url.startsWith('mailto:beta%40example.com?subject=Beta%20feedback')).toBe(true);
    expect(decodeURIComponent(draft.url.split('&body=')[1]!)).toBe(draft.body);
  });

  it('falls back to copying the text when no address is set', () => {
    expect(feedbackDraft({ email: '', repo: '' }, report)).toEqual({
      kind: 'copy',
      body: feedbackBody(report),
    });
    expect(draftKind({ email: '', repo: '' })).toBe('copy');
  });
});

describe('feedbackBody', () => {
  it('lays out what happened, what was expected, the version and the attachment', () => {
    expect(feedbackBody(report)).toBe(
      [
        'What happened:',
        'The Ship button stayed busy',
        'after the checks passed.',
        '',
        'What I expected:',
        'A pull request link.',
        '',
        'Spark Outpost 0.1.0-beta.1 (Beta)',
        'Diagnostics: attached spark-outpost-diagnostics-2026-10-01-120000.zip',
        '',
      ].join('\n'),
    );
  });

  it('keeps a pasted key out of the draft', () => {
    const body = feedbackBody({
      ...report,
      happened: 'It said my key sk-ant-api03-abcdefghijklmnop1234567890 was wrong',
    });
    expect(body).not.toContain('sk-ant');
    expect(body).toContain('[redacted:api_key]');
  });

  it('keeps titles short and marks empty fields', () => {
    const long = { ...report, happened: 'x'.repeat(200), expected: '', version: null, beta: false };
    expect(feedbackTitle(long)).toHaveLength('Feedback: '.length + 70);
    expect(feedbackBody(long)).toContain('What I expected:\n(not filled in)');
    expect(feedbackBody(long)).toContain('Spark Outpost in the browser');
  });
});

describe('feedbackTarget', () => {
  it('reads the build settings and accepts a full GitHub URL', () => {
    expect(
      feedbackTarget({
        VITE_SPARK_FEEDBACK_EMAIL: ' beta@example.com ',
        VITE_SPARK_FEEDBACK_REPO: 'https://github.com/acme/spark-beta',
      }),
    ).toEqual({ email: 'beta@example.com', repo: 'acme/spark-beta' });
    expect(feedbackTarget({})).toEqual({ email: '', repo: '' });
  });

  it('names the saved file without its folder', () => {
    expect(fileName('/Users/me/Downloads/diag.zip')).toBe('diag.zip');
  });
});
