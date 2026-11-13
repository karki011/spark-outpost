import { useEffect } from 'react';
import { openTodayEvent } from '../calendar/today-request.ts';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import type { SettingsSection } from '../settings/section-ids.ts';
import { requestSettingFocus } from '../settings/setting-focus.ts';
import { SHOW_ISLAND_LABEL } from '../settings/setting-labels.ts';
import { openSparksPage } from '../sparks-page/sparks-route.ts';
import { openTeammateSheet } from '../teammates/teammate-store.ts';

export function useDesktopSettingsOpener(setSettings: (section: SettingsSection) => void): void {
  useEffect(
    () =>
      sparkDesktop()?.onOpenSettings?.((target) => {
        if (target === 'sparks') {
          openSparksPage();
          return;
        }
        if (target === 'connectors') {
          setSettings('tools');
          return;
        }
        if (target === 'spark-new') {
          openTeammateSheet({ kind: 'create' });
          return;
        }
        if (target.startsWith('today:')) {
          openTodayEvent(target.slice('today:'.length));
          return;
        }
        if (target.startsWith('spark-edit:')) {
          openTeammateSheet({ kind: 'edit', id: target.slice('spark-edit:'.length) });
          return;
        }
        requestSettingFocus(SHOW_ISLAND_LABEL);
        setSettings('notifications');
      }),
    [setSettings],
  );
}
