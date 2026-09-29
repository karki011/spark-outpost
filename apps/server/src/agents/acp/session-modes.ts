import { isReadOnlyPosture, modeNeedsWorktree, modePosture } from '@spark-outpost/contracts';
import type { ProviderOutput, ProviderTurn } from '../../providers/provider.ts';
import type { AgentDefinition } from './agents.ts';
import { modeName, offersMode, type ModeWish, type SettingsSession } from './apply-settings.ts';
import type { UpdateMapper } from './session-updates.ts';

function doModeWish(definition: AgentDefinition, turn: ProviderTurn): ModeWish {
  const asking = definition.doMode ?? definition.conversationMode;
  const chosen = turn.settings.mode ?? asking;
  if (isReadOnlyPosture(modePosture(definition.id, chosen))) return { wanted: asking };
  if (turn.worktree !== true && modeNeedsWorktree(definition.id, chosen)) {
    return { wanted: asking, note: `${chosen} runs only in a worktree copy; asking instead` };
  }
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
  return doModeWish(definition, turn);
}

export function modeAllowed(
  definition: AgentDefinition,
  turn: ProviderTurn,
  inProject: boolean,
  changing: boolean,
): (mode: string) => boolean {
  if (!inProject) return (mode) => mode === definition.conversationMode;
  if (!changing) {
    return (mode) =>
      mode === definition.askMode || isReadOnlyPosture(modePosture(definition.id, mode));
  }
  return (mode) => turn.worktree === true || !modeNeedsWorktree(definition.id, mode);
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
    push(mapper.note(`${name} runs only in a worktree copy; the mode stays as it was`));
    return;
  }
  try {
    await live.setMode(mode);
    push(mapper.map({ sessionUpdate: 'config_option_update', configOptions: live.options() }));
  } catch {
    push(mapper.note(`${agentName} couldn't switch to ${name}`));
  }
}
