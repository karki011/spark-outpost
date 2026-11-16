import type { UserPlugin } from '@spark-outpost/contracts';
import { requestSettingFocus } from '../../settings/setting-focus.ts';
import { requestSettings } from '../../settings/settings-request.ts';
import { isChecking, isOn, needsConfirm, pluginAdds } from '../../settings/plugin-model.ts';
import { PLUGINS_LABEL } from '../../settings/PluginsSettings.tsx';
import { usePluginSwitch, useUserPlugins } from '../../settings/use-user-plugins.ts';
import { QueryWait } from '../../ui/loading/QueryWait.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import { SetupSwitch } from '../project/SetupCard.tsx';

function reviewInSettings(): void {
  requestSettings('chats');
  requestSettingFocus(PLUGINS_LABEL);
}

function pluginNote(plugin: UserPlugin, error: string | null): string {
  if (error) return error;
  if (!plugin.loadable) return plugin.unloadableReason ?? 'Can’t load in chats';
  if (plugin.changed) return 'Changed · check it in Settings';
  if (isChecking(plugin)) return 'Spark is checking it';
  return pluginAdds(plugin);
}

function PluginRow({ plugin }: { plugin: UserPlugin }) {
  const toggle = usePluginSwitch(plugin);
  const checked = isOn(plugin);
  const note = pluginNote(plugin, toggle.error);
  return (
    <li>
      <span className="mcppop-text">
        <code>{plugin.name}</code>
        <small title={note}>{note}</small>
      </span>
      <SetupSwitch
        label={`Use ${plugin.name} in all Claude chats`}
        checked={checked}
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
    <div className="tools-group">
      <h4 className="tools-sub">
        Claude plugins <span>all Claude chats</span>
      </h4>
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
    </div>
  );
}
