// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestSettingFocus } from './setting-focus.ts';
import { requestSettings } from './settings-request.ts';
import { parseSettingsRoute, routeFor, settingsRouteHash } from './settings-route.ts';
import { useSettingsState } from './use-settings-state.ts';

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

function withDesktopWindow() {
  const open = vi.fn();
  Object.assign(window, {
    sparkDesktop: {
      settingsWindow: { open, onDoc: () => () => undefined },
    },
  });
  return open;
}

afterEach(() => {
  cleanup();
  delete (window as { sparkDesktop?: unknown }).sparkDesktop;
  window.history.replaceState(null, '', '/');
});

describe('settings routes', () => {
  it('reads a section, and the provider route as AI providers', () => {
    expect(parseSettingsRoute('#/settings/notifications')).toBe('notifications');
    expect(parseSettingsRoute('#/settings/providers/claude')).toBe('ai');
    expect(parseSettingsRoute('#/settings/nope')).toBeNull();
    expect(parseSettingsRoute('#/docs/settings')).toBeNull();
    expect(parseSettingsRoute('#/settings/%E0')).toBeNull();
  });

  it('writes a section route, keeping a provider below AI providers', () => {
    expect(settingsRouteHash('chats')).toBe('#/settings/chats');
    expect(settingsRouteHash('ai')).toBe('#/settings/providers');
    expect(routeFor('ai', '#/settings/providers/codex')).toBe('#/settings/providers/codex');
    expect(routeFor('chats', '#/settings/providers/codex')).toBe('#/settings/chats');
  });
});

describe('useSettingsState in a browser', () => {
  it('opens the sheet from a deep link and leaves the link when it closes', () => {
    window.history.replaceState(null, '', '/#/settings/notifications');
    const { result } = renderHook(() => useSettingsState(), { wrapper });
    expect(result.current[0]).toBe('notifications');
    act(() => result.current[1](null));
    expect(result.current[0]).toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('follows a settings link opened later', () => {
    const { result } = renderHook(() => useSettingsState(), { wrapper });
    act(() => {
      window.location.hash = '#/settings/chats';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current[0]).toBe('chats');
  });
});

describe('useSettingsState in the Mac app', () => {
  it('opens the Settings window instead of the sheet, with the row to focus', () => {
    const open = withDesktopWindow();
    const { result } = renderHook(() => useSettingsState(), { wrapper });
    act(() => {
      requestSettingFocus('On wide windows');
      requestSettings('chats');
    });
    expect(open).toHaveBeenCalledWith('#/settings/chats', 'On wide windows');
    expect(result.current[0]).toBeNull();
  });

  it('hands a deep link to the window and clears it from the main window', () => {
    window.history.replaceState(null, '', '/#/settings/providers/claude');
    const open = withDesktopWindow();
    const { result } = renderHook(() => useSettingsState(), { wrapper });
    expect(open).toHaveBeenCalledWith('#/settings/providers/claude', null);
    expect(result.current[0]).toBeNull();
    expect(window.location.hash).toBe('');
  });
});
