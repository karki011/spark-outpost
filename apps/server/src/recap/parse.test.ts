import { expect, it } from 'vitest';
import type { RecapFact } from './facts.ts';
import { groundRefinedText, parseRecapReply, referencesIn } from './parse.ts';

const CHAT = '11111111-1111-4111-8111-111111111111';

const facts: RecapFact[] = [
  { id: 'c1', kind: 'chat', data: {}, refs: [], url: null, chatId: CHAT, waitingOnYou: true },
  {
    id: 'p1',
    kind: 'pull',
    data: {},
    refs: ['#182'],
    url: 'https://github.com/o/r/pull/182',
    chatId: CHAT,
    waitingOnYou: false,
  },
  {
    id: 't1',
    kind: 'ticket',
    data: {},
    refs: ['SPK-12'],
    url: 'https://example.atlassian.net/browse/SPK-12',
    chatId: null,
    waitingOnYou: false,
  },
];

const reply = (value: unknown) => JSON.stringify(value);

it('keeps items that cite facts and links them to the fact with an address', () => {
  const body = parseRecapReply(
    reply({
      done: [
        {
          me: 'I shipped downloads (#182).',
          manager: 'Downloads ask first (#182).',
          facts: ['c1', 'p1'],
        },
      ],
      you: [{ me: 'A chat waits on your answer.', manager: 'ignored', facts: ['c1'] }],
    }),
    facts,
  );
  expect(body?.done).toEqual([
    {
      me: 'I shipped downloads (#182).',
      manager: 'Downloads ask first (#182).',
      url: 'https://github.com/o/r/pull/182',
      chatId: CHAT,
    },
  ]);
  expect(body?.you[0]).toMatchObject({ manager: null, chatId: CHAT, url: null });
});

it('drops items that cite nothing known or name a number their facts do not hold', () => {
  const body = parseRecapReply(
    `Here it is:\n\`\`\`json\n${reply({
      done: [
        { me: 'I did a thing.', manager: 'A thing.', facts: ['x9'] },
        { me: 'I merged #999.', manager: 'Merged #999.', facts: ['p1'] },
        { me: 'I closed SPK-12.', manager: 'SPK-12 closed.', facts: ['p1'] },
        { me: 'I moved SPK-12.', manager: 'SPK-12 moved.', facts: ['t1'] },
      ],
    })}\n\`\`\``,
    facts,
  );
  expect(body?.done.map((item) => item.me)).toEqual(['I moved SPK-12.']);
});

it('keeps things waiting on the user out of the manager-facing help list', () => {
  const body = parseRecapReply(
    reply({
      done: [{ me: 'I moved SPK-12.', manager: 'SPK-12 moved.', facts: ['t1'] }],
      help: [{ me: 'Waiting on my answer.', manager: 'Needs an answer.', facts: ['c1'] }],
    }),
    facts,
  );
  expect(body?.help).toEqual([]);
});

it('fails a reply that is not JSON or keeps nothing', () => {
  expect(parseRecapReply('Sorry, I cannot help.', facts)).toBeNull();
  expect(
    parseRecapReply(reply({ done: [{ me: 'x', manager: 'y', facts: [] }] }), facts),
  ).toBeNull();
  expect(parseRecapReply(reply({}), [])).toEqual({ done: [], progress: [], help: [], you: [] });
});

it('finds pull request numbers and ticket keys', () => {
  expect(referencesIn('Fixed #12 and SPK-4, then INC0012345.')).toEqual([
    '#12',
    'SPK-4',
    'INC0012345',
  ]);
});

it('removes numbers a rewrite made up and keeps those from the facts or the draft', () => {
  const draft = '*Done:* downloads (#182) and ABC-7';
  expect(
    groundRefinedText(
      '```\n*Done:* downloads (#182), ABC-7 and (#400) SPK-12, BAD-1.\n```',
      facts,
      draft,
    ),
  ).toBe('*Done:* downloads (#182), ABC-7 and SPK-12.');
  expect(groundRefinedText('   ', facts, draft)).toBeNull();
});
