import type { UserPlugin } from '@spark-outpost/contracts';
import { requestSettingFocus } from '../../settings/setting-focus.ts';
import { requestSettings } from '../../settings/settings-request.ts';
import { isChecking, isOn, needsConfirm, pluginAdds } from '../../settings/plugin-model.ts';
import { PLUGINS_LABEL } from '../../settings/PluginsSettings.tsx';
import { usePluginSwitch, useUserPlugins } from '../../settings/use-user-plugins.ts';
import { QueryWait } from '../../ui/loading/QueryWait.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import { useId } from 'react';
import { SetupSwitch } from '../project/SetupCard.tsx';
import { ToolsGroupFrame, ToolText } from './ToolsGroupFrame.tsx';

function reviewInSettings(): void {
  requestSettings('chats');
  requestSettingFocus(PLUGINS_LABEL);
}

function pluginStatus(plugin: UserPlugin, error: string | null): string | null {
  if (error) return error;
  if (!plugin.loadable) return plugin.unloadableReason ?? 'Can’t load in chats';
  if (plugin.changed) return 'Changed · check it in Settings';
  if (isChecking(plugin)) return 'Spark is checking it';
  return null;
}

function PluginRow({ plugin }: { plugin: UserPlugin }) {
  const toggle = usePluginSwitch(plugin);
  const checked = isOn(plugin);
  const status = pluginStatus(plugin, toggle.error);
  const noteId = useId();
  return (
    <li>
      <ToolText
        name={plugin.name}
        note={status ?? pluginAdds(plugin)}
        noteId={noteId}
        status={status !== null}
      />
      <SetupSwitch
        label={`Use ${plugin.name} in all Claude chats`}
        checked={checked}
        describedBy={noteId}
        disabled={toggle.busy || !plugin.loadable || (!checked && isChecking(plugin))}
        onChange={(on) => {
          if (on && needsConfirm(plugin)) reviewInSettings();
          else toggle.set(on);
        }}
      />
    </li>
  );
}

export function PluginTools() {
  const plugins = useUserPlugins();
  const list = plugins.data?.plugins ?? [];
  if (plugins.data && list.length === 0) return null;
  return (
    <ToolsGroupFrame
      groupKey="plugins"
      kind="plugins"
      title="Claude plugins"
      scope="all Claude chats"
      summary={plugins.data ? `${list.filter(isOn).length} on` : null}
    >
      <QueryWait query={plugins} what="your plugins">
        <Skeleton label="Loading your plugins" shape="list" rows={2} />
      </QueryWait>
      {list.length > 0 && (
        <ul aria-label={PLUGINS_LABEL}>
          {list.map((plugin) => (
            <PluginRow key={plugin.key} plugin={plugin} />
          ))}
        </ul>
      )}
    </ToolsGroupFrame>
  );
}
