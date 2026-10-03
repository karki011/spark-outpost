import { describe, expect, it } from 'vitest';
import { looksLikePlan } from './plans.ts';

const STEPS = '1. Add the writer\n2. Add the button\n3. Add a test';
const FACTS = '- GitHub: o/r\n- Local path: ~/r\n- No chats yet\n- Map is building';

describe('looksLikePlan', () => {
  it('takes a plan heading or three numbered steps as a plan', () => {
    expect(looksLikePlan('## Plan\nDo it.')).toBe(true);
    expect(looksLikePlan(STEPS)).toBe(true);
  });

  it('does not take a bulleted answer as a plan', () => {
    expect(looksLikePlan(FACTS)).toBe(false);
  });

  it('needs a plan heading when the request was a question', () => {
    expect(looksLikePlan(STEPS, 'question')).toBe(false);
    expect(looksLikePlan(`## Steps\n${STEPS}`, 'question')).toBe(true);
    expect(looksLikePlan(STEPS, 'feature')).toBe(true);
  });
});
