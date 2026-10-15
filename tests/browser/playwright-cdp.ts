import type { CDPSession } from '@playwright/test';
import type { Cdp } from '../../apps/desktop/src/browser/cdp.ts';

const EVENTS = [
  'Page.frameStartedLoading',
  'Page.frameRequestedNavigation',
  'Page.frameNavigated',
  'Page.loadEventFired',
  'Page.navigatedWithinDocument',
  'Runtime.consoleAPICalled',
  'Runtime.exceptionThrown',
  'Log.entryAdded',
  'Network.requestWillBeSent',
  'Network.responseReceived',
  'Network.loadingFailed',
] as const;

export function cdpOf(session: CDPSession): Cdp {
  return {
    send: (method, params) => session.send(method as never, params as never) as Promise<never>,
    listen(listener) {
      const handlers = EVENTS.map((name) => {
        const handler = (params: unknown) =>
          listener(name, (params ?? {}) as Record<string, unknown>);
        session.on(name, handler as never);
        return { name, handler };
      });
      return () => handlers.forEach(({ name, handler }) => session.off(name, handler as never));
    },
    detach: () => void session.detach(),
  };
}
