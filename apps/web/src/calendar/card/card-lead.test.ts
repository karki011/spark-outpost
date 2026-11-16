import { describe, expect, it } from 'vitest';
import { at, event, link } from '../test-fixtures.ts';
import { cardLead } from './card-lead.ts';

const standup = event('Standup', at(10, 30), at(10, 45), { link: link('zoom') });

describe('cardLead', () => {
  it('offers Join at start while the meeting is more than two minutes away', () => {
    expect(cardLead(standup, at(10, 20))).toBe('join-at-start');
    expect(cardLead(standup, at(10, 27, 59))).toBe('join-at-start');
  });

  it('offers Join from two minutes before the start and once it has started', () => {
    expect(cardLead(standup, at(10, 28))).toBe('join');
    expect(cardLead(standup, at(10, 35))).toBe('join');
  });

  it('says the meeting is planned to open once Join at start is set', () => {
    expect(cardLead({ ...standup, joinAtStart: true }, at(10, 20))).toBe('planned');
    expect(cardLead({ ...standup, joinAtStart: true }, at(10, 31))).toBe('join');
  });

  it('offers Join for a meeting without a link', () => {
    expect(cardLead({ ...standup, link: null }, at(10, 20))).toBe('join');
  });
});
