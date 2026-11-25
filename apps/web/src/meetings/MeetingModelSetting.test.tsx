// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeetingModelSetting, modelHint } from './MeetingModelSetting.tsx';
import { mockFetch, newClient } from './meetings-test-support.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the meeting model setting', () => {
  it('shows nothing and asks for nothing where meetings cannot be recorded', async () => {
    const calls = mockFetch(({ path }) => {
      if (path === '/meetings/status') {
        return {
          supported: false,
          available: false,
          reason: 'Needs the Mac app.',
          recordingId: null,
        };
      }
    });
    const { container } = render(
      <QueryClientProvider client={newClient()}>
        <MeetingModelSetting />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(calls.some((call) => call.path === '/meetings/status')).toBe(true));
    expect(container.textContent).toBe('');
    expect(calls.some((call) => call.path === '/meetings/model')).toBe(false);
  });

  it('says which model writes notes and where questions start', () => {
    const none = { provider: null, model: null, effort: null };
    expect(modelHint({ settings: none, runsOn: null })).toBe('Connect a provider first.');
    const runsOn = { provider: 'claude' as const, model: 'h', modelLabel: 'Haiku', effort: null };
    expect(modelHint({ settings: none, runsOn })).toBe(
      'Notes are written with Haiku. A new meeting’s questions start on the provider’s chat model.',
    );
    expect(modelHint({ settings: { ...none, model: 'h' }, runsOn })).toBe(
      'Notes are written with Haiku, and a new meeting’s questions start on it.',
    );
  });
});
