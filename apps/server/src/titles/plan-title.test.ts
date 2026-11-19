import { describe, expect, it } from 'vitest';
import { planTitle } from './plan-title.ts';

describe('planTitle', () => {
  it('takes the top heading and drops a Plan: prefix', () => {
    expect(planTitle('# Plan: Add dark mode to Settings\n\n## Steps\n1. Tokens')).toBe(
      'Add dark mode to Settings',
    );
  });

  it('skips a bare Plan heading for the first line that says something', () => {
    expect(planTitle('# Plan\n\n**Wire the row line** into the chat list.')).toBe(
      'Wire the row line into the chat list',
    );
    expect(planTitle('## Overview\n- Fix the date divider')).toBe('Fix the date divider');
  });

  it('prefers a top heading anywhere over earlier body text', () => {
    expect(planTitle('Here is what I will do.\n\n# Split the cost pane')).toBe(
      'Split the cost pane',
    );
  });

  it('clips a long line at a word', () => {
    const title = planTitle(
      'Refactor the summary query so the list reads the plan entry in the same pass as progress',
    );
    expect(title!.length).toBeLessThanOrEqual(60);
    expect(title!.endsWith('…')).toBe(true);
  });

  it('gives nothing for a plan with no words', () => {
    expect(planTitle('# Plan\n\n---\n1.')).toBeNull();
    expect(planTitle('')).toBeNull();
  });
});
