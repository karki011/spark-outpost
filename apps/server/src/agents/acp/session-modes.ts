import { isReadOnlyPosture, modePosture } from '@spark-outpost/contracts';
import type { ProviderOutput, ProviderTurn } from '../../providers/provider.ts';
import type { AgentDefinition } from './agents.ts';
import { modeName, offersMode, type ModeWish, type SettingsSession } from './apply-settings.ts';
import type { UpdateMapper } from './session-updates.ts';

function doModeWish(definition: AgentDefinition, turn: ProviderTurn): ModeWish {
  const asking = definition.doMode ?? definition.conversationMode;
  const chosen = turn.settings.mode ?? asking;
  if (isReadOnlyPosture(modePosture(definition.id, chosen))) return { wanted: asking };
  return { wanted: chosen, fallback: asking };
}

export function modeWish(
  definition: AgentDefinition,
  turn: ProviderTurn,
  inProject: boolean,
  changing: boolean,
): ModeWish {
  if (!inProject) return { wanted: definition.conversationMode };
  if (!changing)
    return turn.planning
      ? { wanted: definition.askMode, plan: true }
      : { wanted: definition.askMode };
  const wish = doModeWish(definition, turn);
  return turn.plansFirst ? { ...wish, plan: true } : wish;
}

export function modeAllowed(
  definition: AgentDefinition,
  inProject: boolean,
  changing: boolean,
): (mode: string) => boolean {
  if (!inProject) return (mode) => mode === definition.conversationMode;
  if (!changing) {
    return (mode) => {
      const posture = modePosture(definition.id, mode);
      return mode === definition.askMode || isReadOnlyPosture(posture) || posture === 'unknown';
    };
  }
  return () => true;
}

export async function switchMode(
  live: SettingsSession,
  mode: string,
  allowed: (mode: string) => boolean,
  agentName: string,
  push: (outputs: ProviderOutput[]) => void,
  mapper: UpdateMapper,
): Promise<void> {
  if (mode === mapper.currentMode()) return;
  const name = modeName(live.options(), mode);
  if (!offersMode(live.options(), mode)) {
    push(mapper.note(`${agentName} doesn't offer ${name} in this session`));
    return;
  }
  if (!allowed(mode)) {
    push(mapper.note(`${name} can't be used in this turn; the mode stays as it was`));
    return;
  }
  try {
    await live.setMode(mode);
    push(mapper.map({ sessionUpdate: 'config_option_update', configOptions: live.options() }));
  } catch {
    push(mapper.note(`${agentName} couldn't switch to ${name}`));
  }
}
