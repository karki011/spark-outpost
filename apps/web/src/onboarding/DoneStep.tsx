import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { useQueries } from '@tanstack/react-query';
import {
  shownModelName,
  type InvolvementLevel,
  type ProviderCapabilities,
  type ProviderId,
  type ProviderSetup,
} from '@spark-outpost/contracts';
import { CAPABILITIES_STALE_MS, capabilitiesQuery } from '../api/client.ts';
import { modeSummary } from '../chat/composer/mode-summary.ts';
import { currentModel } from '../chat/composer/model-options.ts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { ProviderBlob } from '../brand/ProviderBlob.tsx';
import { UserBlob } from '../brand/UserBlob.tsx';
import { readTheme, themes } from '../theme/theme.ts';
import { burstAt } from '../ui/sparks.ts';
import { reveal } from '../ui/transitions.tsx';
import { useGitItem, useToolItems, type SummaryItem } from './done-tools.tsx';
import './done.css';

interface DoneStepProps {
  displayName: string;
  providers: ProviderSetup[];
  defaultProvider: ProviderId | null;
  level: InvolvementLevel;
}

function providerItem(
  provider: ProviderSetup,
  capabilities: ProviderCapabilities | undefined,
  isDefault: boolean,
  level: InvolvementLevel,
): SummaryItem | null {
  const connection = provider.connection;
  if (!connection) return null;
  const reported = currentModel(connection, capabilities);
  const model = reported
    ? shownModelName(reported)
    : (connection.models.find((option) => option.id === connection.model)?.label ??
      'CLI default model');
  const effort = connection.effort
    ? (provider.efforts.find((option) => option.id === connection.effort)?.label ??
      connection.effort)
    : 'Per-chat';
  const permission = modeSummary(
    provider.id,
    connection.agentMode ?? capabilities?.defaultMode ?? null,
    level,
    capabilities?.modes ?? [],
  );
  return {
    key: provider.id,
    icon: <ProviderBlob providerId={provider.id} size={30} expression="happy" animate="always" />,
    title: (
      <>
        <b>{provider.name}</b> via {connection.method === 'api_key' ? 'API key' : 'local CLI'}
        {isDefault && <span className="tag-default">Default</span>}
      </>
    ),
    detail: `${model}, ${effort.toLowerCase()} effort, ${permission}`,
  };
}

export function DoneStep({ displayName, providers, defaultProvider, level }: DoneStepProps) {
  const scoutRef = useRef<HTMLDivElement>(null);
  const connected = providers.filter((provider) => provider.connection);
  const capabilities = useQueries({
    queries: connected.map((provider) => ({
      ...capabilitiesQuery(provider.id),
      staleTime: CAPABILITIES_STALE_MS,
    })),
  });
  const toolItems = useToolItems();
  const gitItem = useGitItem();
  const firstName = displayName.trim().split(/\s+/)[0] ?? '';
  const themeId = readTheme();
  const theme = themes.find((option) => option.id === themeId) ?? themes[0];

  useEffect(() => {
    const first = setTimeout(() => burstAt(scoutRef.current, 26, 110), 350);
    const second = setTimeout(() => burstAt(scoutRef.current, 14, 70), 900);
    return () => {
      clearTimeout(first);
      clearTimeout(second);
    };
  }, []);

  const items: SummaryItem[] = [
    {
      key: 'you',
      icon: <UserBlob displayName={displayName} size={30} expression="happy" animate="always" />,
      title: <b>{displayName.trim()}</b>,
      detail: 'This is you in chats',
    },
    {
      key: 'theme',
      icon: (
        <span
          className="theme-dot"
          data-skin={theme.id === 'system' ? undefined : theme.id}
          aria-hidden="true"
        >
          <i />
        </span>
      ),
      title: (
        <>
          <b>{theme.label}</b> theme
        </>
      ),
      detail: theme.description,
    },
    ...connected.flatMap((provider, index) => {
      const item = providerItem(
        provider,
        capabilities[index]?.data,
        connected.length > 1 && provider.id === defaultProvider,
        level,
      );
      return item ? [item] : [];
    }),
    ...(gitItem ? [gitItem] : []),
    ...toolItems,
  ];

  return (
    <div className="done-wrap">
      <motion.div
        ref={scoutRef}
        className="done-hero"
        initial={{ scale: 0.8, y: 12, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ type: 'spring', bounce: 0.45, visualDuration: 0.5 }}
      >
        <span className="done-halo" aria-hidden="true" />
        <BlobScout
          size={96}
          mood="happy"
          lookAtPointer
          onClick={() => burstAt(scoutRef.current, 18, 90)}
        />
      </motion.div>
      <motion.h2
        id="onbTitle"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...reveal, delay: 0.12 }}
      >
        You're all set, {firstName}{' '}
        <span className="wave" aria-hidden="true">
          👋
        </span>
      </motion.h2>
      <p className="lede">Here's your outpost. You can change any of it in Settings.</p>
      <ul className="done-list">
        {items.map((item, index) => (
          <motion.li
            key={item.key}
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...reveal, delay: 0.25 + index * 0.08 }}
          >
            <span className="done-ic">{item.icon}</span>
            <span className="done-text">
              <span className="done-title">{item.title}</span>
              <small>{item.detail}</small>
            </span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
