import { describe, expect, it } from 'vitest';
import {
  SLACK_APP_MANIFEST,
  SLACK_BOT_SCOPES,
  SLACK_DM_SCOPES,
  escapeSlackText,
  missingSlackDmScopes,
  parseSlackMessageUrl,
  saveSlackConnectionRequestSchema,
  slackPlaceLabel,
  slackSettingsSchema,
} from './slack.ts';
import { redactText } from './secrets.ts';

describe('parseSlackMessageUrl', () => {
  it('reads the channel and timestamp of a message link', () => {
    expect(parseSlackMessageUrl('https://acme.slack.com/archives/C0ENG/p1760000000000100')).toEqual(
      {
        channelId: 'C0ENG',
        ts: '1760000000.000100',
        threadTs: null,
      },
    );
  });

  it('reads the parent of a reply link', () => {
    expect(
      parseSlackMessageUrl(
        ' https://acme.enterprise.slack.com/archives/C0ENG/p1760000060000200?thread_ts=1760000000.000100&cid=C0ENG ',
      ),
    ).toEqual({ channelId: 'C0ENG', ts: '1760000060.000200', threadTs: '1760000000.000100' });
  });

  it('refuses links that are not Slack message links', () => {
    for (const link of [
      'http://acme.slack.com/archives/C0ENG/p1760000000000100',
      'https://acme.slack.com.evil.test/archives/C0ENG/p1760000000000100',
      'https://evil.test/acme.slack.com/archives/C0ENG/p1760000000000100',
      'https://acme.slack.com/archives/C0ENG',
      'https://acme.slack.com/archives/C0ENG/p17600',
      'https://acme.slack.com/archives/c0eng/p1760000000000100',
      'look at https://acme.slack.com/archives/C0ENG/p1760000000000100',
      '',
    ]) {
      expect(parseSlackMessageUrl(link), link).toBeNull();
    }
  });

  it('ignores a malformed thread_ts', () => {
    expect(
      parseSlackMessageUrl('https://acme.slack.com/archives/C0ENG/p1760000000000100?thread_ts=1')
        ?.threadTs,
    ).toBeNull();
  });
});

describe('escapeSlackText', () => {
  it('disarms mentions, channel pings and links', () => {
    expect(escapeSlackText('<!channel> ping <@U1> & <https://x.test|click>')).toBe(
      '&lt;!channel&gt; ping &lt;@U1&gt; &amp; &lt;https://x.test|click&gt;',
    );
  });
});

describe('Slack tokens', () => {
  it('accepts each token only in its own field and treats blanks as absent', () => {
    const parsed = saveSlackConnectionRequestSchema.parse({
      botToken: ' xoxb-1111111111-abcdefgh ',
      userToken: '',
      appToken: '  ',
    });
    expect(parsed).toEqual({ botToken: 'xoxb-1111111111-abcdefgh' });
    expect(
      saveSlackConnectionRequestSchema.safeParse({ botToken: 'xoxp-1111111111-abcdefgh' }).success,
    ).toBe(false);
  });

  it('redacts every Slack token type in text', () => {
    const text = redactText(
      'bot xoxb-1111111111-abcdefgh user xoxp-2222222222-abcdefgh app xapp-1-A0-3333333333-abcdefgh',
    );
    expect(text).not.toMatch(/xox[bp]-\d|xapp-1/);
  });
});

describe('Slack manifest and defaults', () => {
  it('asks for exactly the documented scopes and Socket Mode', () => {
    expect(SLACK_APP_MANIFEST.oauth_config.scopes.bot).toEqual(Object.keys(SLACK_BOT_SCOPES));
    expect(SLACK_APP_MANIFEST.oauth_config.scopes.bot).not.toContain('im:history');
    expect(SLACK_APP_MANIFEST.settings.socket_mode_enabled).toBe(true);
    expect(SLACK_APP_MANIFEST.features.shortcuts[0].callback_id).toBe('spark_start_work');
  });

  it('asks for the direct message scopes on the user token only, and reads none by default', () => {
    const { bot, user } = SLACK_APP_MANIFEST.oauth_config.scopes;

    expect(user).toEqual(expect.arrayContaining([...SLACK_DM_SCOPES]));
    expect(bot.filter((scope) => /^(im|mpim):/.test(scope))).toEqual([]);
    expect(slackSettingsSchema.parse({})).toMatchObject({
      readDirectMessages: false,
      allDirectMessages: false,
    });
  });

  it('names the direct message scopes a token lacks', () => {
    expect(missingSlackDmScopes(null)).toEqual([...SLACK_DM_SCOPES]);
    expect(missingSlackDmScopes(['search:read', 'im:read', 'im:history'])).toEqual([
      'mpim:read',
      'mpim:history',
    ]);
    expect(missingSlackDmScopes([...SLACK_DM_SCOPES])).toEqual([]);
  });

  it('labels channels, direct messages and group messages', () => {
    expect(slackPlaceLabel({ kind: 'channel', name: 'eng' })).toBe('#eng');
    expect(slackPlaceLabel({ kind: 'im', name: 'Sam Ortiz' })).toBe(
      'direct message with Sam Ortiz',
    );
    expect(slackPlaceLabel({ kind: 'mpim', name: 'alex, sam' })).toBe(
      'group message with alex, sam',
    );
  });

  it('defaults to notifying about everything but flags, quiet while focused', () => {
    expect(slackSettingsSchema.parse({})).toMatchObject({
      notify: { needs_you: true, finished: true, failed: true, pr_opened: true, flag: false },
      quietWhenFocused: true,
      notifyChannelId: null,
      allowedUserIds: [],
    });
  });
});
