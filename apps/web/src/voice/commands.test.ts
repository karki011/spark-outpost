import { describe, expect, it } from 'vitest';
import { matchCommand, matchConfirmation, speechHint, type SpeechLists } from './commands.ts';
import { similarity } from './fuzzy.ts';
import { ticketKey, tokens } from './normalise.ts';

const lists: SpeechLists = {
  projects: [
    { id: 'p1', name: 'feature-web-apps', folder: '/Users/me/code/feature-web-apps' },
    { id: 'p2', name: 'spark-outpost', folder: '/Users/me/spark-outpost' },
    { id: 'p3', name: 'Billing', folder: '/Users/me/billing-service' },
  ],
  chats: [
    { id: 'c1', title: 'Dashboards' },
    { id: 'c2', title: 'Fix login redirect' },
    { id: 'c3', title: 'Dashboard filters' },
    { id: 'c4', title: 'Release notes' },
  ],
  tickets: [
    { source: 'jira', key: 'CP-49084', title: 'Add creator email' },
    { source: 'jira', key: 'CP-12', title: 'Old one' },
    { source: 'linear', key: 'ENG-7', title: 'Faster boot' },
  ],
};

describe('ticket keys', () => {
  it('joins spelled letters and number words into a key', () => {
    expect(ticketKey('C P four nine zero eight four')).toBe('CP-49084');
    expect(ticketKey('see pee four nine oh eight four')).toBe('CP-49084');
    expect(ticketKey('CP-49084')).toBe('CP-49084');
    expect(ticketKey('cp 49084')).toBe('CP-49084');
    expect(ticketKey('E N G seven')).toBe('ENG-7');
  });

  it('leaves ordinary words alone', () => {
    expect(tokens('start a chat for one thing')).toEqual([
      'start',
      'a',
      'chat',
      'for',
      'one',
      'thing',
    ]);
    expect(ticketKey('the dashboards')).toBeNull();
  });
});

describe('matchCommand', () => {
  it('fills a new chat with the project, ticket and task from the design’s phrase', () => {
    const command = matchCommand(
      'Spark, start a chat in feature web apps for C P four nine zero eight four add creator email',
      lists,
    );
    expect(command).toMatchObject({
      intent: 'start_chat',
      project: { picked: { id: 'p1' } },
      ticket: { key: 'CP-49084', source: 'jira', known: true },
      task: 'add creator email',
    });
  });

  it('copes with what whisper actually heard for it', () => {
    const command = matchCommand(
      'Start a chat and feature, web apps, for CP-49084, at Creator Email.',
      lists,
    );
    expect(command).toMatchObject({
      intent: 'start_chat',
      project: { picked: { id: 'p1' } },
      ticket: { key: 'CP-49084' },
      task: 'at Creator Email',
    });
  });

  it('keeps a key that parses but is not cached, for the detail lookup', () => {
    const command = matchCommand('work on CP 777 in spark outpost fix the tests', lists);
    expect(command).toMatchObject({
      intent: 'start_chat',
      project: { picked: { id: 'p2' } },
      ticket: { key: 'CP-777', known: false, source: 'jira' },
      task: 'fix the tests',
    });
  });

  it('opens the Dashboards chat, preselected over Dashboard filters', () => {
    const command = matchCommand('Open the Dashboards Chat.', lists);
    expect(command.intent).toBe('open');
    if (command.intent !== 'open') return;
    expect(command.target.picked).toEqual({
      kind: 'chat',
      chat: { id: 'c1', title: 'Dashboards' },
    });
    expect(command.target.choices.map((choice) => choice.value)).toContainEqual({
      kind: 'chat',
      chat: { id: 'c3', title: 'Dashboard filters' },
    });
  });

  it('asks which one when two names are close', () => {
    const command = matchCommand('open the dashboard chat', {
      ...lists,
      chats: [
        { id: 'a', title: 'Dashboard A' },
        { id: 'b', title: 'Dashboard B' },
      ],
    });
    if (command.intent !== 'open') throw new Error(command.intent);
    expect(command.target.picked).toBeNull();
    expect(command.target.choices).toHaveLength(2);
  });

  it('says nothing matched rather than inventing a project', () => {
    const command = matchCommand('start a chat in zebra crossing to paint it', lists);
    if (command.intent !== 'start_chat') throw new Error(command.intent);
    expect(command.project.picked).toBeNull();
    expect(command.project.choices).toEqual([]);
    expect(command.project.heard).toBe('zebra crossing');
  });

  it('recognises the instant questions', () => {
    expect(matchCommand('Who needs me?', lists)).toMatchObject({
      intent: 'ask_fast',
      question: 'needs',
    });
    expect(matchCommand('What’s running', lists)).toMatchObject({
      intent: 'ask_fast',
      question: 'running',
    });
    expect(matchCommand('what did I spend today', lists)).toMatchObject({ question: 'spend' });
    expect(matchCommand('What tickets do I have pending?', lists)).toMatchObject({
      question: 'tickets',
    });
    expect(matchCommand("What's the status of C P one two", lists)).toMatchObject({
      intent: 'ask_fast',
      question: 'ticket_status',
      ticket: { key: 'CP-12', known: true },
    });
  });

  it('drafts a reply to a chat', () => {
    expect(
      matchCommand('reply to fix login redirect saying ship it after lunch', lists),
    ).toMatchObject({
      intent: 'reply',
      chat: { picked: { id: 'c2' } },
      text: 'ship it after lunch',
    });
  });

  it('sends anything else to Ask Spark as text', () => {
    expect(matchCommand('Why did the billing build fail yesterday?', lists)).toEqual({
      intent: 'none',
      text: 'Why did the billing build fail yesterday',
    });
  });
});

describe('matchConfirmation', () => {
  it('hears yes, no and which one', () => {
    expect(matchConfirmation('Send it.')).toEqual({ answer: 'yes' });
    expect(matchConfirmation('yes')).toEqual({ answer: 'yes' });
    expect(matchConfirmation('Cancel')).toEqual({ answer: 'no' });
    expect(matchConfirmation('the second one')).toEqual({ answer: 'pick', index: 1 });
    expect(matchConfirmation('approve the push')).toBeNull();
  });
});

describe('fuzzy matching', () => {
  it('scores a folder name heard as words', () => {
    expect(similarity('feature web apps', 'feature-web-apps')).toBe(1);
    expect(similarity('spark out post', 'spark-outpost')).toBeGreaterThan(0.85);
    expect(similarity('zebra', 'Billing')).toBeLessThan(0.6);
  });

  it('builds a hint from names and ticket prefixes', () => {
    expect(speechHint(lists)).toContain('feature-web-apps');
    expect(speechHint(lists)).toContain('CP');
    expect(speechHint(lists).length).toBeLessThanOrEqual(600);
  });
});
