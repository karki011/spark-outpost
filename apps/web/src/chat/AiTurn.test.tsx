// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AiTurn } from './AiTurn.tsx';
import { TurnFaceContext, type TurnFace } from './turn-face.ts';

afterEach(cleanup);

describe('the head of an agent turn', () => {
  it("shows the agent's name and blob in a chat", () => {
    const { container } = render(
      <AiTurn provider="claude" label="done" state="done">
        <p>Reply</p>
      </AiTurn>,
    );
    expect(screen.getByText('Claude')).toBeTruthy();
    expect(container.querySelector('[data-turn-face]')).toBeNull();
  });

  it('shows the face and name it is given instead, with the turn state', () => {
    const face: TurnFace = {
      name: '@web',
      face: (state) => <i data-turn-face={state} />,
    };
    const { container } = render(
      <TurnFaceContext value={face}>
        <AiTurn provider="claude" label="waiting for you" state="waiting">
          <p>Reply</p>
        </AiTurn>
      </TurnFaceContext>,
    );
    expect(screen.getByText('@web')).toBeTruthy();
    expect(screen.queryByText('Claude')).toBeNull();
    expect(container.querySelector('[data-turn-face]')?.getAttribute('data-turn-face')).toBe(
      'waiting',
    );
  });
});
