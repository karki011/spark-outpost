import type { BridgePort, WorkerBridge } from './browser/bridge.ts';
import type { MenuPaneShortcut } from './help-menu.ts';
import { startBrowserHost, type BrowserHostOptions } from './browser/host.ts';
import { startCalendarHost, type CalendarHostOptions } from './calendar/host.ts';
import { joinBridges } from './mac-control/bridge.ts';
import { startMacControlHost, type MacControlHostOptions } from './mac-control/host.ts';

export interface AgentHosts {
  connectWorker(port: BridgePort): WorkerBridge;
  windowClosed(): void;
  menuShortcut(shortcut: MenuPaneShortcut): boolean;
  dispose(): void;
}

export async function startAgentHosts(
  browserOptions: BrowserHostOptions,
  macOptions: MacControlHostOptions,
  calendarOptions: CalendarHostOptions,
): Promise<AgentHosts> {
  const browser = await startBrowserHost(browserOptions);
  const mac = startMacControlHost(macOptions);
  const calendar = startCalendarHost(calendarOptions);
  return {
    connectWorker: (port) =>
      joinBridges([
        browser.connectWorker(port),
        mac.connectWorker(port),
        calendar.connectWorker(port),
      ]),
    windowClosed: () => browser.windowClosed(),
    menuShortcut: (shortcut) => browser.menuShortcut(shortcut),
    dispose() {
      browser.dispose();
      mac.dispose();
      calendar.dispose();
    },
  };
}
