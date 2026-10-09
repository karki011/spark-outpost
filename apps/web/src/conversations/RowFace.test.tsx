// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { chat, FE_CHAT } from '../outposts/test-fixtures.ts';
import { RowFace } from './RowFace.tsx';

const SPARK = {
  id: '0e000000-0000-4000-8000-000000000001',
  name: 'Dora',
  role: 'Docs',
  face: { shape: 'sun', color: 'gold' },
} as const;

afterEach(cleanup);

describe('RowFace', () => {
  it('draws the chat its own blob', () => {
    const { container } = render(<RowFace chat={chat(FE_CHAT)} state="working" />);
    expect(container.querySelectorAll('.chat-face')).toHaveLength(1);
    expect(container.querySelector('.rface')).toBeNull();
  });

  it('draws only the Spark face for a chat started with a Spark', () => {
    const { container } = render(
      <RowFace chat={chat(FE_CHAT, { teammate: SPARK })} state="needs_you" />,
    );
    expect(container.querySelector('.chat-face')).toBeNull();
    expect(container.querySelectorAll('.rface .tm-face')).toHaveLength(1);
    expect(container.querySelector('.rface')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws a Spark chat in History without failing', () => {
    const { container } = render(
      <RowFace chat={chat(FE_CHAT, { teammate: SPARK })} state="archived" />,
    );
    expect(container.querySelectorAll('.tm-face')).toHaveLength(1);
  });
});
