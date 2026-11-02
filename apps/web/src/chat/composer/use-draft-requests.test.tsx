// @vitest-environment jsdom
import { createRef, StrictMode, useLayoutEffect, useState } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  queueDraft,
  queueDraftAfterTyped,
  requestComposerFocus,
  takeDraft,
  useComposerFocusRequest,
} from './pending-draft.ts';
import { useDraftRequests } from './use-draft-requests.ts';

const CHAT = '00000000-0000-4000-8000-000000000002';

afterEach(() => {
  takeDraft(CHAT);
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

function typedComposer(typed: string) {
  const ref = createRef<HTMLTextAreaElement>();
  return renderHook(() => {
    const [draft, setDraft] = useState(typed);
    useDraftRequests(CHAT, setDraft, ref, 0);
    return draft;
  });
}

describe('text put back in the composer', () => {
  it('keeps what the user had typed when Edit restores removed messages', () => {
    const { result } = typedComposer('Also check the docs.');
    act(() => queueDraftAfterTyped(CHAT, 'First\n\nSecond'));
    expect(result.current).toBe('Also check the docs.\n\nFirst\n\nSecond');
  });

  it('preserves text entered after render before the restored draft is applied', () => {
    queueDraftAfterTyped(CHAT, 'Restored message');
    const ref = createRef<HTMLTextAreaElement>();
    const { result } = renderHook(() => {
      const [draft, setDraft] = useState('Original text');
      useDraftRequests(CHAT, setDraft, ref, 0);
      useLayoutEffect(() => setDraft('Original text plus new typing'), []);
      return draft;
    });
    expect(result.current).toBe('Original text plus new typing\n\nRestored message');
  });

  it('restores a pending message once when Strict Mode replays effects', () => {
    queueDraftAfterTyped(CHAT, 'Restored message');
    const ref = createRef<HTMLTextAreaElement>();
    const { result } = renderHook(
      () => {
        const [draft, setDraft] = useState('Typed message');
        useDraftRequests(CHAT, setDraft, ref, 0);
        return draft;
      },
      { wrapper: StrictMode },
    );
    expect(result.current).toBe('Typed message\n\nRestored message');
  });

  it('fills an empty composer with the restored messages alone', () => {
    const { result } = typedComposer('  ');
    act(() => queueDraftAfterTyped(CHAT, 'First'));
    expect(result.current).toBe('First');
  });

  it('still replaces the text for a prefilled draft', () => {
    const { result } = typedComposer('Old words');
    act(() => queueDraft(CHAT, 'About `a.ts`: '));
    expect(result.current).toBe('About `a.ts`: ');
  });
});
