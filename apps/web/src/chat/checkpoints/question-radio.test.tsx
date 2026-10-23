// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type CheckpointQuestion } from '@spark-outpost/contracts';
import { checkpoint } from '../../crew/test-orchestration.ts';
import type { Decide } from './card-parts.tsx';
import { isCheckpoint, type CheckpointApproval } from './checkpoint-model.ts';
import { QuestionsBody } from './QuestionsBody.tsx';

afterEach(cleanup);

function card(questions: CheckpointQuestion[]): CheckpointApproval {
  const approval = checkpoint(
    { kind: 'clarify', agent: 'Claude', questions },
    {
      options: [
        { optionId: CHECKPOINT_OPTION.answer, name: 'Send', kind: 'allow_once' },
        { optionId: CHECKPOINT_OPTION.finish, name: 'Skip', kind: 'reject_once' },
      ],
    },
  );
  if (!isCheckpoint(approval)) throw new Error('not a checkpoint');
  return approval;
}

const decide: Decide = Object.assign(() => undefined, {
  busy: false,
  countdown: null,
  hold: () => undefined,
});

const store: CheckpointQuestion = {
  question: 'Which store?',
  options: ['Postgres', 'Redis', 'SQLite'],
  default: '',
  pick: 'one',
};

function radios() {
  const group = screen.getByRole('radiogroup', { name: /choose one/ });
  return within(group).getAllByRole('radio');
}

const checked = () => radios().map((radio) => String((radio as HTMLInputElement).checked));
const tabStops = () => radios().map((radio) => radio.tabIndex);

describe('a single-choice question', () => {
  it('draws a radio group with one tab stop, on the first answer until one is picked', () => {
    render(<QuestionsBody approval={card([store])} decide={decide} />);
    expect(checked()).toEqual(['false', 'false', 'false']);
    expect(tabStops()).toEqual([0, -1, -1]);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);

    fireEvent.click(radios()[1]!);
    expect(checked()).toEqual(['false', 'true', 'false']);
    expect(tabStops()).toEqual([-1, 0, -1]);
  });

  it('keeps the answer checked when it is clicked again', () => {
    render(<QuestionsBody approval={card([store])} decide={decide} />);
    fireEvent.click(radios()[2]!);
    fireEvent.click(radios()[2]!);
    expect(checked()).toEqual(['false', 'false', 'true']);
  });

  it('moves and checks with the arrow keys', () => {
    render(<QuestionsBody approval={card([store])} decide={decide} />);
    const [postgres, redis] = radios();
    postgres!.focus();
    fireEvent.keyDown(postgres!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(redis);
    expect(checked()).toEqual(['false', 'true', 'false']);
    fireEvent.keyDown(redis!, { key: 'ArrowRight' });
    expect(checked()).toEqual(['false', 'false', 'true']);
    fireEvent.keyDown(radios()[2]!, { key: 'ArrowLeft' });
    fireEvent.keyDown(radios()[1]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(postgres);
    expect(checked()).toEqual(['true', 'false', 'false']);
  });

  it('wraps at either end and stays in the group, even when the question takes text', () => {
    render(<QuestionsBody approval={card([{ ...store, freeText: true }])} decide={decide} />);
    const [postgres, , sqlite] = radios();
    sqlite!.focus();
    fireEvent.keyDown(sqlite!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(postgres);
    expect(checked()).toEqual(['true', 'false', 'false']);
    fireEvent.keyDown(postgres!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(sqlite);
    expect(checked()).toEqual(['false', 'false', 'true']);
  });

  it('checks the answer a number key names', () => {
    render(<QuestionsBody approval={card([store])} decide={decide} />);
    radios()[0]!.focus();
    fireEvent.keyDown(radios()[0]!, { key: '3' });
    expect(checked()).toEqual(['false', 'false', 'true']);
  });
});

describe('a choose-any question', () => {
  it('uses checkboxes', () => {
    const checks = { ...store, pick: 'many' as const };
    render(<QuestionsBody approval={card([checks])} decide={decide} />);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    const postgres = screen.getByRole('checkbox', { name: /Postgres/ });
    fireEvent.click(postgres);
    fireEvent.click(screen.getByRole('checkbox', { name: /Redis/ }));
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(2);
    fireEvent.click(postgres);
    expect((postgres as HTMLInputElement).checked).toBe(false);
  });

  it('moves with Up and Down only, without checking', () => {
    render(<QuestionsBody approval={card([{ ...store, pick: 'many' }])} decide={decide} />);
    const postgres = screen.getByRole('checkbox', { name: /Postgres/ });
    const redis = screen.getByRole('checkbox', { name: /Redis/ });
    postgres.focus();
    fireEvent.keyDown(postgres, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(postgres);
    fireEvent.keyDown(postgres, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(redis);
    expect(screen.queryAllByRole('checkbox', { checked: true })).toHaveLength(0);
  });
});
