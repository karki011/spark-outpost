import { useId } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AUTONOMY_LEVELS,
  type InvolvementLevel,
  type ProviderId,
  type ProviderSetup,
} from '@spark-outpost/contracts';
import { setupApi, setupKey } from '../api/setup.ts';
import { SettingRow } from '../settings/SettingRow.tsx';
import { Segmented } from '../ui/Segmented.tsx';

const LABEL = 'How much Spark does alone';
const INFO = AUTONOMY_LEVELS.map((level) => `${level.label}: ${level.hint}`).join(' ');
const OPTIONS = AUTONOMY_LEVELS.map((level) => ({ id: level.id, label: level.label }));

interface LevelSettingProps {
  providers: readonly ProviderSetup[];
  defaultProvider: ProviderId | null;
}

export function LevelSetting({ providers, defaultProvider }: LevelSettingProps) {
  const hintId = useId();
  const queryClient = useQueryClient();
  const connected = providers.filter((provider) => provider.connection);
  const save = useMutation({
    mutationFn: async (level: InvolvementLevel) => {
      let state = null;
      for (const provider of connected) {
        state = await setupApi.updateDefaults(provider.id, { level });
      }
      return state;
    },
    onSuccess: (state) => {
      if (state) queryClient.setQueryData(setupKey, state);
    },
  });
  const shown = connected.find((provider) => provider.id === defaultProvider) ?? connected[0];
  if (!shown?.connection) return null;
  const level = save.isPending ? save.variables : shown.connection.level;
  return (
    <SettingRow
      label={LABEL}
      info={INFO}
      hint={
        save.isError
          ? save.error.message
          : 'The default for every connected agent. Change one agent in AI providers.'
      }
      hintId={hintId}
    >
      <Segmented
        ariaLabel={LABEL}
        describedBy={hintId}
        options={OPTIONS}
        value={level}
        onChange={(id) => {
          const picked = AUTONOMY_LEVELS.find((entry) => entry.id === id);
          if (picked) save.mutate(picked.id);
        }}
      />
    </SettingRow>
  );
}
