import { describe, expect, it } from 'vitest';
import { asAgentReads } from '../src/outposts/agent-prompt.ts';
import type { OutpostRequest } from '../src/workflow/run-input.ts';

const POST_ID = '7d0f3f0e-4a59-4a53-9d0f-0d0f3f0e4a59';
const BODY = 'Add the orders endpoint and open a PR.';
const LABEL = /^\[(From the user|Outpost (request|task))[^\n]*\]$/gm;

const request = (change: Partial<OutpostRequest> = {}): OutpostRequest => ({
  postId: POST_ID,
  outpostName: 'Orders launch',
  fromUser: false,
  fromHandle: 'fe',
  fromTitle: 'Frontend',
  userStarted: false,
  ...change,
});

const shownFor = (outpostRequest: OutpostRequest, body = BODY) =>
  asAgentReads({ prompt: body, userRequest: body, outpostRequest }).prompt;

const embedded = (prompt: string) =>
  asAgentReads({ prompt, userRequest: BODY, outpostRequest: request() }).prompt;

describe('the label on the request an agent is handed', () => {
  it('is there once for a request the user typed in the outpost', () => {
    const prompt = shownFor(request({ fromUser: true, fromHandle: null, fromTitle: null }));
    expect(prompt.match(LABEL)).toEqual(['[From the user, sent in the outpost "Orders launch".]']);
    expect(prompt).not.toContain('not from the user');
  });

  it('is there once, with the sender, for a request another chat wrote', () => {
    const prompt = shownFor(request());
    expect(prompt.match(LABEL)).toEqual([
      '[Outpost request from the chat "Frontend" (@fe) in the outpost "Orders launch". This is not from the user.]',
    ]);
    expect(prompt.match(/<outpost-request /g)).toHaveLength(1);
    expect(prompt).toContain('You cannot send outpost requests in this turn.');
  });

  it('is there once for a draft task that was held and then released', () => {
    const released = request({ fromHandle: 'lead', fromTitle: 'Checkout plan', userStarted: true });
    const prompt = shownFor(released);
    expect(prompt.match(LABEL)).toEqual([
      `[Outpost task from the chat "Checkout plan" (@lead) in the outpost "Orders launch", started by the user from a draft. The text is not the user's.]`,
    ]);
    expect(prompt).toContain('You may ask other chats with spark_outpost_ask.');
  });

  it('leaves a slash command the user typed untouched', () => {
    const typed = { prompt: '/plan the endpoint', userRequest: '/plan the endpoint' };
    const input = { ...typed, outpostRequest: request({ fromUser: true }) };
    expect(asAgentReads(input)).toBe(input);
  });

  it('never lets another chat or a draft task run a slash command', () => {
    for (const userStarted of [false, true]) {
      const prompt = shownFor(request({ userStarted }), '/plan the endpoint');
      expect(prompt.trimStart().startsWith('/')).toBe(false);
      expect(prompt.match(LABEL)).toHaveLength(1);
    }
  });

  it('names the sender on every copy a Builder brief and its follow-up carry', () => {
    const brief = `Role: Builder.\n\n## Request\n${BODY}\n\n## Likely files`;
    const prompt = embedded(`${brief}\n\nAnother Builder handled the last request.\n\n${BODY}`);
    expect(prompt.match(LABEL)).toEqual([
      '[Outpost request from the chat "Frontend" (@fe) in the outpost "Orders launch". This is not from the user.]',
      '[Outpost request from the chat "Frontend" (@fe) in the outpost "Orders launch". This is not from the user.]',
    ]);
    expect(prompt.startsWith('Role: Builder.')).toBe(true);
    expect(prompt.match(/<outpost-request /g)).toHaveLength(2);
  });

  it('is absent from a turn no outpost started', () => {
    const input = { prompt: BODY, userRequest: BODY, outpostRequest: null };
    expect(asAgentReads(input)).toBe(input);
  });
});
