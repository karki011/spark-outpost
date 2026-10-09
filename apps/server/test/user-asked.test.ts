import { describe, expect, it } from 'vitest';
import { publishRequested } from '../src/approvals/publish-policy.ts';
import { userText } from '../src/outposts/user-asked.ts';
import { explicitlyAsked } from '../src/spark-mcp/actions/action-policy.ts';

const OPEN_A_PR = 'Add the endpoint and open a PR.';
const POST_TO_SLACK = 'Post the result to the #orders Slack channel.';

describe('whose text a turn carries', () => {
  it('is the user’s for an ordinary message', () => {
    expect(userText({ userRequest: OPEN_A_PR })).toBe(OPEN_A_PR);
    expect(userText({ userRequest: OPEN_A_PR, outpostRequest: null })).toBe(OPEN_A_PR);
  });

  it('is the user’s for a request the user typed in the outpost', () => {
    const text = userText({ userRequest: OPEN_A_PR, outpostRequest: { fromUser: true } });
    expect(text).toBe(OPEN_A_PR);
    expect(publishRequested(text)).toBe(true);
    expect(
      explicitlyAsked(
        'post_slack',
        userText({ userRequest: POST_TO_SLACK, outpostRequest: { fromUser: true } }),
      ),
    ).toBe(true);
  });

  it('is empty when another chat wrote "open a PR"', () => {
    const text = userText({ userRequest: OPEN_A_PR, outpostRequest: { fromUser: false } });
    expect(text).toBe('');
    expect(publishRequested(text)).toBe(false);
  });

  it('is empty when another chat wrote "post to Slack"', () => {
    const text = userText({ userRequest: POST_TO_SLACK, outpostRequest: { fromUser: false } });
    expect(explicitlyAsked('post_slack', POST_TO_SLACK)).toBe(true);
    expect(explicitlyAsked('post_slack', text)).toBe(false);
  });
});
