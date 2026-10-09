import { describe, expect, it } from 'vitest';
import { asAgentReads } from '../src/outposts/agent-prompt.ts';
import { wrapRequest } from '../src/outposts/request-prompt.ts';

const POST_ID = '7d0f3f0e-4a59-4a53-9d0f-0d0f3f0e4a59';
const BODY = 'Add the orders endpoint.';

const request = (fromUser: boolean) => ({
  postId: POST_ID,
  outpostName: 'Orders launch',
  fromUser,
});

const wrapped = (kind: 'user' | 'other', body = BODY) =>
  wrapRequest({ postId: POST_ID, outpostName: 'Orders launch', author: { kind }, body });

const turn = (change: Partial<Parameters<typeof asAgentReads>[0]> = {}) => ({
  prompt: BODY,
  userRequest: BODY,
  outpostRequest: request(true),
  ...change,
});

describe('what the agent is handed for a turn', () => {
  it('is the same object for a turn no outpost started', () => {
    const ordinary = turn({ outpostRequest: null, followUp: `note\n\n${BODY}` });
    expect(asAgentReads(ordinary)).toBe(ordinary);
    const unset = { prompt: BODY, userRequest: BODY };
    expect(asAgentReads(unset)).toBe(unset);
  });

  it('is the wrapped request for a request the user typed in the outpost', () => {
    const shown = asAgentReads(turn());
    expect(shown.prompt).toBe(wrapped('user'));
    expect(shown.userRequest).toBe(BODY);
    expect(shown).not.toHaveProperty('followUp');
  });

  it('keeps what Spark added after the request', () => {
    const shown = asAgentReads(turn({ prompt: `${BODY}\n\nEnd with Needs you if unsure.` }));
    expect(shown.prompt).toBe(`${wrapped('user')}\n\nEnd with Needs you if unsure.`);
  });

  it('wraps the request at the end of a follow-up for a continued session', () => {
    const shown = asAgentReads(turn({ followUp: `The session was compacted.\n\n${BODY}` }));
    expect(shown.followUp).toBe(`The session was compacted.\n\n${wrapped('user')}`);
  });

  it('leaves a brief and a follow-up that are not the request alone', () => {
    const brief = turn({
      prompt: `Role: Builder.\n\n## Request\n${BODY}\n\nLikely files: a.ts`,
      followUp: 'Fix the failing check.',
    });
    const shown = asAgentReads(brief);
    expect(shown.prompt).toBe(brief.prompt);
    expect(shown.followUp).toBe('Fix the failing check.');
  });

  it('hands over a slash command the user typed exactly as typed, so it stays a command', () => {
    const slash = turn({ prompt: '/plan the endpoint', userRequest: '/plan the endpoint' });
    expect(asAgentReads(slash)).toBe(slash);
  });

  it('never hands over a slash command the user did not write as a command', () => {
    const body = '/plan the endpoint';
    const shown = asAgentReads(
      turn({ prompt: body, userRequest: body, outpostRequest: request(false) }),
    );
    expect(shown.prompt).toBe(wrapped('other', body));
    expect(shown.prompt.trimStart().startsWith('/')).toBe(false);
    expect(shown.prompt.split('\n')[0]).toBe(
      '[Outpost request, sent in the outpost "Orders launch". This is not from the user.]',
    );
  });
});
