import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { ProviderError, type ProviderOutput } from '../../providers/provider.ts';
import { modeName, type SettingsSession } from './apply-settings.ts';
import type { CommandTracker } from './command-output.ts';
import type { RailWatch } from './rail-watch.ts';
import type { RanModelWatch } from './ran-model.ts';
import { subagentMark } from './subagent-stream.ts';
import type { TurnMapper } from './subagent-updates.ts';

export interface UpdateSink {
  agentName: string;
  live: SettingsSession;
  mapper: TurnMapper;
  ranModel: RanModelWatch;
  commands: CommandTracker;
  rails: RailWatch | null;
  flagsRails: boolean;
  push: (outputs: ProviderOutput[]) => void;
}

export function updateSink(sink: UpdateSink): (update: SessionUpdate) => Promise<void> {
  const { live, mapper, push } = sink;
  return async (update) => {
    if (update.sessionUpdate === 'config_option_update') live.adopt(update.configOptions);
    if (update.sessionUpdate === 'current_mode_update') live.adoptMode(update.currentModeId);
    push(mapper.map(update));
    push(sink.ranModel.see(update));
    if (subagentMark(update)?.event !== 'update') push(sink.commands.see(update));
    const observed = await sink.rails?.observe(update);
    for (const flag of sink.flagsRails ? (observed?.rails ?? []) : []) {
      push([{ kind: 'rail_flag', flag }]);
    }
    if (observed?.secretReads.length) {
      push([{ kind: 'secret_read', paths: observed.secretReads }]);
    }
    const unsafe = mapper.unsafeModeChange();
    if (unsafe) {
      throw new ProviderError(
        `${sink.agentName} switched to ${modeName(live.options(), unsafe)} mode, so the run was stopped.`,
      );
    }
  };
}
