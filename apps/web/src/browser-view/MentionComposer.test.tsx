// @vitest-environment jsdom
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MentionComposer } from './MentionComposer.tsx';

afterEach(cleanup);

it.each([true, false])(
  'preserves typing while a browser question settles (success=%s)',
  async (success) => {
    let resolve!: () => void;
    let reject!: () => void;
    const send = vi.fn(
      () =>
        new Promise<void>((done, fail) => {
          resolve = done;
          reject = fail;
        }),
    );
    render(
      <MentionComposer
        input={createRef()}
        open={new Map()}
        mentions={[]}
        onMentions={() => undefined}
        busy={false}
        onSend={send}
        onClose={() => undefined}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Ask Spark' }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'First question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.change(input, { target: { value: 'Next question' } });
    await act(async () => (success ? resolve() : reject()));
    expect(input.value).toBe(success ? 'Next question' : 'Next question\n\nFirst question');
    expect(send).toHaveBeenCalledWith('First question');
  },
);
