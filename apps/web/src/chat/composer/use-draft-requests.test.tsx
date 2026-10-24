// @vitest-environment jsdom
import { createRef } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { requestComposerFocus, useComposerFocusRequest } from './pending-draft.ts';
import { useDraftRequests } from './use-draft-requests.ts';

const CHAT = '00000000-0000-4000-8000-000000000002';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function composer(input: HTMLTextAreaElement | null) {
  const ref = createRef<HTMLTextAreaElement>();
  (ref as { current: HTMLTextAreaElement | null }).current = input;
  return renderHook(() => {
    useDraftRequests(CHAT, () => undefined, ref, 0);
    return useComposerFocusRequest(CHAT);
  });
}

function textarea(): HTMLTextAreaElement {
  const input = document.createElement('textarea');
  document.body.append(input);
  return input;
}

describe('a focus request for the composer', () => {
  it('waits for a composer to mount, focuses it once, and is then used up', () => {
    const away = composer(null);
    act(() => requestComposerFocus(CHAT));
    expect(away.result.current).not.toBe(0);
    away.unmount();

    const first = textarea();
    const back = composer(first);
    expect(document.activeElement).toBe(first);
    expect(back.result.current).toBe(0);
    back.unmount();

    first.blur();
    const second = textarea();
    composer(second);
    expect(document.activeElement).not.toBe(second);
  });
});
