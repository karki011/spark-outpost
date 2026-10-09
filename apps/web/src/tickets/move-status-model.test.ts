import { describe, expect, it } from 'vitest';
import type { TicketMoveOptions } from '@spark-outpost/contracts';
import { AUTOMATIC, moveChoices, moveNotes, withMove } from './move-status-model.ts';

const quiet = { choices: ['In Progress'], to: 'In Progress', problem: null };
const options: TicketMoveOptions = {
  projects: [
    {
      project: 'CP',
      moves: {
        in_progress: quiet,
        in_review: quiet,
        done: { choices: ['Done', 'Rejected'], to: 'Done', problem: null },
      },
    },
    {
      project: 'OPS',
      moves: {
        in_progress: quiet,
        in_review: quiet,
        done: {
          choices: ['Shipped', 'Released', 'rejected'],
          to: null,
          problem: 'Several finished statuses: Shipped, Released. Choose one.',
        },
      },
    },
  ],
};

describe('move status choices', () => {
  it('offers Automatic and every project’s real statuses once', () => {
    expect(moveChoices(options, 'done', undefined).map((choice) => choice.label)).toEqual([
      'Automatic',
      'Done',
      'Rejected',
      'Shipped',
      'Released',
    ]);
    expect(moveChoices(undefined, 'done', 'Closed').map((choice) => choice.id)).toEqual([
      AUTOMATIC,
      'Closed',
    ]);
  });

  it('says what Automatic uses, and warns where it cannot choose', () => {
    expect(moveNotes(options, 'done', undefined)).toEqual([
      { project: 'CP', text: 'Automatic uses Done.', warn: false },
      {
        project: 'OPS',
        text: 'Several finished statuses: Shipped, Released. Choose one.',
        warn: true,
      },
    ]);
  });

  it('says where a chosen status applies and where it is missing', () => {
    const chosen: TicketMoveOptions = {
      projects: [
        { ...options.projects[0]!, moves: { ...options.projects[0]!.moves } },
        {
          project: 'OPS',
          moves: {
            ...options.projects[1]!.moves,
            done: { choices: ['Shipped', 'Released'], to: 'Shipped', problem: null },
          },
        },
      ],
    };
    expect(moveNotes(chosen, 'done', 'Shipped')).toEqual([
      { project: 'CP', text: 'No status named Shipped here, so Automatic uses Done.', warn: true },
      { project: 'OPS', text: 'Moves to Shipped.', warn: false },
    ]);
  });

  it('saves a choice and clears it for Automatic', () => {
    expect(withMove({ in_review: 'QA' }, 'done', 'Done')).toEqual({
      in_review: 'QA',
      done: 'Done',
    });
    expect(withMove({ in_review: 'QA', done: 'Done' }, 'done', AUTOMATIC)).toEqual({
      in_review: 'QA',
    });
  });
});
