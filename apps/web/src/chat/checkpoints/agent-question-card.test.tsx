// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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

function card(overrides: Partial<Approval> = {}): CheckpointApproval {
  const base = checkpoint(
    { kind: 'clarify', agent: 'Codex', questions: formQuestions(form) },
    {
      options: [
        { optionId: CHECKPOINT_OPTION.answer, name: 'Send', kind: 'allow_once' },
        { optionId: CHECKPOINT_OPTION.finish, name: 'Skip', kind: 'reject_once' },
      ],
      ...overrides,
    },
  );
  const approval = { ...base, payload: { ...base.payload, form } };
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
});
