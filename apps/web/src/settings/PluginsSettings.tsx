import './plugins.css';
import { useRef, useState } from 'react';
import type { UserPlugin } from '@spark-outpost/contracts';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { pluginSummary } from './plugin-model.ts';
import { PluginRow } from './PluginRow.tsx';
import { useSettingFocus } from './setting-focus.ts';
import { useSteadyOrder, useUserPlugins } from './use-user-plugins.ts';

export const PLUGINS_LABEL = 'Claude plugins';

const FILTER_FROM = 6;

function PluginItems({ plugins }: { plugins: readonly UserPlugin[] }) {
  const [filter, setFilter] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const filterable = plugins.length >= FILTER_FROM;
  const shown = useSteadyOrder(plugins, filterable ? filter : '');
  return (
    <>
      <div className={filterable ? 'set-list-bar plug-bar' : 'plug-summary'}>
        {filterable && (
          <input
            type="search"
            className="inp"
            aria-label="Filter plugins"
            placeholder="Filter by name, marketplace or description"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        )}
        <span className="set-hint" role="status">
          {pluginSummary(plugins, shown.length)}
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="set-hint">No plugins match “{filter.trim()}”.</p>
      ) : (
        <ul className="plug-list" aria-label={PLUGINS_LABEL}>
          {shown.map((plugin) => (
            <PluginRow
              key={plugin.key}
              plugin={plugin}
              open={plugin.key === openKey}
              onToggle={() => setOpenKey(plugin.key === openKey ? null : plugin.key)}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function PluginList() {
  const query = useUserPlugins();
  if (!query.data) {
    return (
      <QueryWait query={query} what="your plugins">
        <Skeleton label="Loading your plugins" shape="list" rows={3} />
      </QueryWait>
    );
  }
  if (query.data.plugins.length === 0) {
    return <p className="set-hint">No Claude plugins installed.</p>;
  }
  return <PluginItems plugins={query.data.plugins} />;
}

export function PluginsSettings() {
  const section = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useSettingFocus(PLUGINS_LABEL, section, list);
  return (
    <section ref={section} className="spark-group" aria-labelledby="chats-plugins">
      <h4 id="chats-plugins">Plugins</h4>
      <p className="set-hint plug-intro">
        Claude plugins you installed with <code>claude plugin install</code>. Selected plugins load
        in Claude chats; Terminal sessions load your plugins as usual.
      </p>
      <p className="set-hint plug-intro">
        Spark checks each plugin before you turn it on. A check is a flag, not a guarantee.
      </p>
      <div ref={list}>
        <PluginList />
      </div>
    </section>
  );
}
