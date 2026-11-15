import './rail-tools.css';
import '../../settings/mcp/mcp.css';
import type { Project, UserPlugin } from '@spark-outpost/contracts';
import { requestSettingFocus } from '../../settings/setting-focus.ts';
import { requestSettings } from '../../settings/settings-request.ts';
import { isChecking, isOn, needsConfirm, pluginAdds } from '../../settings/plugin-model.ts';
import { PLUGINS_LABEL } from '../../settings/PluginsSettings.tsx';
import { usePluginSwitch, useUserPlugins } from '../../settings/use-user-plugins.ts';
import { QueryWait } from '../../ui/loading/QueryWait.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import { ChatMcpRows } from '../composer/ChatMcpRows.tsx';
import { RailConnectors } from './RailConnectors.tsx';
import { RailSetup } from './RailSetup.tsx';
import { useChatMcp } from '../composer/use-chat-mcp.ts';
import { SetupSwitch } from '../project/SetupCard.tsx';
import { usePaneId } from '../split/chat-pane.ts';

interface RailToolsProps {
  conversationId: string;
  repos: readonly Project[];
  showPlugins: boolean;
}

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

function RailPlugin({ plugin }: { plugin: UserPlugin }) {
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

function RailPlugins() {
  const plugins = useUserPlugins();
  const list = plugins.data?.plugins ?? [];
  if (plugins.data && list.length === 0) return null;
  return (
    <div className="crail-tool-group">
      <h4 className="crail-sub">
        Claude plugins <span>all Claude chats</span>
      </h4>
      <QueryWait query={plugins} what="your plugins">
        <Skeleton label="Loading your plugins" shape="list" rows={2} />
      </QueryWait>
      {list.length > 0 && (
        <ul aria-label={PLUGINS_LABEL}>
          {list.map((plugin) => (
            <RailPlugin key={plugin.key} plugin={plugin} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function RailTools({ conversationId, repos, showPlugins }: RailToolsProps) {
  const { servers, toggle, setForChat } = useChatMcp(conversationId);
  const list = servers.data?.servers ?? [];
  const titleId = usePaneId('chat-rail-tools');
  return (
    <section className="crail-tools mcppop" aria-labelledby={titleId}>
      <h3 id={titleId} className="crail-title">
        Tools
      </h3>
      <RailSetup repos={repos} />
      <div className="crail-tool-group">
        <h4 className="crail-sub">
          MCP servers <span>this chat</span>
        </h4>
        <QueryWait query={servers} what="MCP servers">
          <Skeleton label="Finding MCP servers" shape="list" rows={2} />
        </QueryWait>
        {servers.data && list.length === 0 && <p className="crail-empty">None added yet.</p>}
        {list.length > 0 && (
          <ChatMcpRows servers={list} busy={toggle.isPending} onSet={setForChat} />
        )}
        {toggle.isError && (
          <p className="mcp-error" role="alert">
            {toggle.error.message}
          </p>
        )}
      </div>
      {showPlugins && <RailPlugins />}
      <RailConnectors />
      <p className="crail-empty">
        Changes apply to the next message.
        {repos.length > 0 && ' Hooks and trust are in Agent setup under the message box.'}
      </p>
      <button type="button" className="crail-manage" onClick={() => requestSettings('mcp')}>
        Manage tools
      </button>
    </section>
  );
}
