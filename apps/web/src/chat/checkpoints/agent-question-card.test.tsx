// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHECKPOINT_OPTION,
  formQuestions,
  type AgentForm,
  type Approval,
} from '@spark-outpost/contracts';
import { checkpoint } from '../../crew/test-orchestration.ts';
import { AskedList } from './ClarifyBody.tsx';
import type { Decide } from './card-parts.tsx';
import { isCheckpoint, type CheckpointApproval } from './checkpoint-model.ts';
import { QuestionsBody } from './QuestionsBody.tsx';

afterEach(cleanup);

const form: AgentForm = {
  message: 'A few details',
  fields: [
    {
      key: 'notify',
      kind: 'boolean',
      question: 'Notify the team?',
      options: [],
      required: false,
      noteKey: null,
      otherValue: null,
      minimum: null,
      maximum: null,
      minLength: null,
      maxLength: null,
      minItems: null,
      maxItems: null,
      default: true,
    },
  ],
};

const field = form.fields[0]!;

const stores: AgentForm = {
  message: 'Two questions',
  fields: [
    {
      ...field,
      key: 'store',
      kind: 'one',
      question: 'Which store?',
      options: [
        { value: 'pg', label: 'Postgres' },
        { value: 'redis', label: 'Redis' },
      ],
      noteKey: 'storeNote',
      default: 'pg',
    },
    {
      ...field,
      key: 'checks',
      kind: 'many',
      question: 'Which checks?',
      options: [
        { value: 'lint', label: 'Lint' },
        { value: 'types', label: 'Types' },
      ],
      noteKey: 'checksNote',
      default: null,
    },
  ],
};

function card(overrides: Partial<Approval> = {}, asked: AgentForm = form): CheckpointApproval {
  const base = checkpoint(
    { kind: 'clarify', agent: 'Codex', questions: formQuestions(asked) },
    {
      options: [
        { optionId: CHECKPOINT_OPTION.answer, name: 'Send', kind: 'allow_once' },
        { optionId: CHECKPOINT_OPTION.finish, name: 'Skip', kind: 'reject_once' },
      ],
      ...overrides,
    },
  );
  const approval = { ...base, payload: { ...base.payload, form: asked } };
  if (!isCheckpoint(approval)) throw new Error('not a checkpoint');
  return approval;
}

const decide: Decide = Object.assign(() => undefined, {
  busy: false,
  countdown: null,
  hold: () => undefined,
});

describe('an agent’s question card', () => {
  it('can be sent with the agent’s defaults alone', () => {
    render(<QuestionsBody approval={card()} decide={decide} />);
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('shows the default as used only when the answer was sent', () => {
    const skipped = card({ status: 'denied', decisionOptionId: CHECKPOINT_OPTION.finish });
    const { container, rerender } = render(<AskedList approval={skipped} />);
    expect(container.textContent).not.toContain('Best guess');
    const sent = card({ status: 'allowed', decisionOptionId: CHECKPOINT_OPTION.answer });
    rerender(<AskedList approval={sent} />);
    expect(container.textContent).toContain('Best guess: Yes');
  });

  it('picks one answer with radios and number keys, starting from the agent’s best guess', () => {
    render(<QuestionsBody approval={card({}, stores)} decide={decide} />);
    const choices = screen.getByRole('radiogroup', { name: /Which store\?/ });
    const postgres = within(choices).getByRole('radio', { name: /^Postgres/ });
    const redis = within(choices).getByRole('radio', { name: /^Redis/ });
    expect((postgres as HTMLInputElement).checked).toBe(true);
    expect(postgres.closest('label')?.textContent).toContain('Codex’s best guess');
    fireEvent.keyDown(postgres, { key: '2' });
    expect((redis as HTMLInputElement).checked).toBe(true);
    expect((postgres as HTMLInputElement).checked).toBe(false);
  });

  it('has one Something else field, and typing in it clears the pick-one answer', () => {
    render(<QuestionsBody approval={card({}, stores)} decide={decide} />);
    const fields = screen.getAllByRole('textbox');
    expect(fields).toHaveLength(1);
    expect(fields[0]!.getAttribute('placeholder')).toBe('Something else…');
    fireEvent.change(fields[0]!, { target: { value: 'SQLite' } });
    expect((screen.getByRole('radio', { name: /^Postgres/ }) as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it('keeps checkboxes for a choose-any question and counts the questions', () => {
    const sent = vi.fn();
    const sending: Decide = Object.assign(sent, {
      busy: false,
      countdown: null,
      hold: () => undefined,
    });
    render(<QuestionsBody approval={card({}, stores)} decide={sending} />);
    expect(screen.getByText('1 of 2')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('radio', { name: /^Postgres/ }), { key: 'Enter' });
    expect(screen.getByText('2 of 2')).toBeTruthy();
    const lint = screen.getByRole('checkbox', { name: /^Lint/ });
    fireEvent.keyDown(lint, { key: '1' });
    fireEvent.keyDown(lint, { key: '2' });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(sent).toHaveBeenCalledWith(CHECKPOINT_OPTION.answer, expect.any(String), [
      { picks: ['Postgres'], text: '' },
      { picks: ['Lint', 'Types'], text: '' },
    ]);
  });
});
