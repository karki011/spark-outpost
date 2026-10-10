import { describe, expect, it } from 'vitest';
import { coordinatorPrompt } from '../src/coordinator/prompts.ts';
import { answerPrompt } from '../src/coordinator/mid-build.ts';
import { builderPrompt, criticPrompt, REQUEST_LIMIT } from '../src/orchestration/context.ts';
import { withCrewNotes } from '../src/orchestration/member-prompts.ts';
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

  it('leaves a follow-up that does not carry the request', () => {
    const shown = asAgentReads(turn({ followUp: 'Fix the failing check.' }));
    expect(shown.followUp).toBe('Fix the failing check.');
  });

  it('hands over a slash command the user typed exactly as typed, so it stays a command', () => {
    const slash = turn({ prompt: '/plan the endpoint', userRequest: '/plan the endpoint' });
    expect(asAgentReads(slash)).toBe(slash);
  });

  it('wraps a slash command that carries a handle, so a message to several chats stays text', () => {
    for (const body of ['/plan the endpoint with @api and @web', '/compact @all']) {
      const shown = asAgentReads(turn({ prompt: body, userRequest: body }));
      expect(shown.prompt).toBe(wrapped('user', body));
      expect(shown.prompt.trimStart().startsWith('/')).toBe(false);
    }
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

const labels = (text: string) => text.split(`<outpost-request id="${POST_ID}">`).length - 1;

const builderBrief = (request: string) =>
  builderPrompt({ request, history: [], note: null, findings: [], likelyFiles: '## Likely files' });

describe('a request embedded in a brief Spark wrote', () => {
  it('is labelled once under Request in a fresh Builder prompt', () => {
    const shown = asAgentReads(turn({ prompt: builderBrief(BODY) }));

    expect(labels(shown.prompt)).toBe(1);
    expect(shown.prompt).toContain(`## Request\n${wrapped('user')}\n\n## Likely files`);
    expect(shown.prompt.startsWith('Role: Builder.')).toBe(true);
  });

  it('says a Builder request another chat wrote is not from the user', () => {
    const shown = asAgentReads(
      turn({ prompt: builderBrief(BODY), outpostRequest: request(false) }),
    );

    expect(shown.prompt).toContain(`## Request\n${wrapped('other')}\n\n`);
    expect(labels(shown.prompt)).toBe(1);
  });

  it('keeps what the user told the crew outside the label', () => {
    const noted = withCrewNotes(BODY, [{ name: 'Ada', body: 'use the v2 route' }]);
    const shown = asAgentReads(turn({ prompt: builderBrief(noted) }));

    expect(shown.prompt).toContain(`${wrapped('user')}\n\nWhile the crew worked`);
    expect(labels(shown.prompt)).toBe(1);
  });

  it('is labelled once in a Critic, a Coordinator and a mid-build answer prompt', () => {
    const critic = criticPrompt({ request: BODY, plan: [], changes: [], patch: '', checks: [] });
    const coordinator = coordinatorPrompt({
      request: BODY,
      agreedPlan: null,
      likelyFiles: [],
      planFiles: [],
      checks: [],
      budgetTokens: 100_000,
    });
    const answer = answerPrompt('How far along is it?', BODY, { pieces: [] } as never);

    for (const prompt of [
      critic,
      coordinator,
      answer,
      `## Glue\nJoin them.\n\n## Request\n${BODY}`,
    ]) {
      const shown = asAgentReads(turn({ prompt })).prompt;
      expect(labels(shown)).toBe(1);
      expect(shown).toContain(wrapped('user'));
    }
  });

  it('labels the part of a long request a brief kept', () => {
    const body = `${'Add the orders endpoint. '.repeat(400)}`.trim();
    const kept = body.slice(0, REQUEST_LIMIT);
    const shown = asAgentReads(turn({ prompt: builderBrief(body), userRequest: body }));

    expect(body.length).toBeGreaterThan(REQUEST_LIMIT);
    expect(labels(shown.prompt)).toBe(1);
    expect(shown.prompt).toContain(
      `## Request\n${wrapped('user', kept)}\n[cut at ${REQUEST_LIMIT} characters]`,
    );
  });

  it('labels only text that stands on its own lines, never the same words inside a sentence', () => {
    const body = 'Builder';
    const shown = asAgentReads(turn({ prompt: builderBrief(body), userRequest: body }));

    expect(labels(shown.prompt)).toBe(1);
    expect(shown.prompt.startsWith('Role: Builder. Make the change')).toBe(true);
    expect(shown.prompt).toContain(`## Request\n${wrapped('user', body)}\n\n`);
  });

  it('labels every copy when a brief and the follow-up after it both carry the request', () => {
    const prompt = `${builderBrief(BODY)}\n\nAnother Builder handled the last request.\n\n${BODY}`;
    const shown = asAgentReads(turn({ prompt }));

    expect(labels(shown.prompt)).toBe(2);
    expect(shown.prompt.replaceAll(wrapped('user'), '')).not.toContain(BODY);
  });

  it('leaves a brief built from a slash command the user typed as it is', () => {
    const body = '/plan the endpoint';
    const brief = turn({ prompt: builderBrief(body), userRequest: body });

    expect(asAgentReads(brief)).toBe(brief);
  });

  it('leaves a prompt that does not carry the request as it is', () => {
    const shown = asAgentReads(turn({ prompt: '## Publish this change\nPush the branch.' }));

    expect(shown.prompt).toBe('## Publish this change\nPush the branch.');
  });
});
