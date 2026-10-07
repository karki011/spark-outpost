import type * as acp from '@agentclientprotocol/sdk';
import type { RoleTurn } from './fake-acp-roles.ts';

const FAKE_QUESTIONS = {
  questions: [{ question: 'Which report?', options: ['Spend', 'Usage'], default: 'Spend' }],
};

const OLD_ROWS_QUESTIONS = {
  questions: [
    {
      question: 'Which old report rows should go?',
      options: ['Older than 90 days', 'Older than a year'],
      default: 'Delete rows older than 90 days',
    },
  ],
};

const THREE_QUESTIONS = {
  questions: [
    {
      question: 'What would you like next?',
      options: ['Testing & tooling setup', 'Recent changes summary', 'Open work / tech debt'],
      default: 'Deep dive on one feature',
    },
    {
      question: 'Which area should I focus on?',
      options: ['Explorer', 'Views', 'Connections'],
      default: 'Pulse',
    },
    {
      question: 'How deep should it go?',
      options: ['Quick summary', 'File-level walkthrough'],
      default: 'Walkthrough + gotchas',
    },
  ],
};

const LONG_OPTION_QUESTIONS = {
  questions: [
    {
      question:
        'The reports page mixes spend and usage in one table. How should the new version split them, given finance reads spend weekly and engineers read usage daily?',
      options: [
        'Two tabs on the same page, spend first, each with its own date range and export button so neither team scrolls past the other',
        'One table with a toggle that swaps the columns, keeping the current address and saved filters working for everyone who bookmarked it',
        'Separate pages linked from the sidebar, with the old address redirecting to spend because that is what most visitors open today',
      ],
      default: 'Two tabs on the same page, spend first, keeping the current filters for both',
    },
  ],
};

function oneQuestion(text: string) {
  if (text.includes('#longoptions')) return LONG_OPTION_QUESTIONS;
  return text.includes('#oldrows') ? OLD_ROWS_QUESTIONS : FAKE_QUESTIONS;
}

const THREE_QUESTIONS_REPLY = [
  '"Anything" can go a few ways, so here is some extra context first, then three questions.',
  'From what I found:',
  ...Array.from(
    { length: 14 },
    (_, index) =>
      `- **Area ${index + 1}:** \`libs/features/area-${index + 1}\` had recent changes, mostly bug fixes and follow-ups that are still open.`,
  ),
  'Questions:',
  '1. What would you like next? My guess: a deeper dive into one feature.',
  '2. Which area should I look at? My guess: Pulse, since it is the most active right now.',
  '3. How deep should it go? My guess: a walkthrough with the gotchas.',
].join('\n\n');

export async function askQuestions(turn: RoleTurn): Promise<acp.StopReason> {
  if (turn.text.includes('#three')) {
    const block = ['```clarify', JSON.stringify(THREE_QUESTIONS), '```'].join('\n');
    await turn.say(`${THREE_QUESTIONS_REPLY}\n\n${block}`);
    return 'end_turn';
  }
  const asked = oneQuestion(turn.text);
  const block = ['```clarify', JSON.stringify(asked), '```'].join('\n');
  await turn.say(`1. Which report do you mean: Spend or Usage?\n\n${block}`);
  return 'end_turn';
}

export async function askNothing(turn: RoleTurn): Promise<acp.StopReason> {
  await turn.say('I could not tell what to ask about.');
  return 'end_turn';
}
