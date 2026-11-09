import type * as acp from '@agentclientprotocol/sdk/unstable';

export const MODE_SWITCH_TRIGGER = '#modeswitch';
export const MODE_WAIT_TRIGGER = '#waitmode';

interface ModeTurn {
  text: string;
  config: Record<string, string>;
  options: () => acp.SessionConfigOption[];
  update: (value: acp.SessionUpdate) => Promise<void>;
  say: (chunk: string) => Promise<void>;
  signal: AbortSignal;
}

const argAfter = (text: string, trigger: string) =>
  text
    .slice(text.indexOf(trigger) + trigger.length)
    .trim()
    .split(/\s+/)[0] ?? '';

export async function modeTurn(turn: ModeTurn): Promise<acp.StopReason | null> {
  if (turn.text.includes(MODE_SWITCH_TRIGGER)) {
    turn.config.mode = argAfter(turn.text, MODE_SWITCH_TRIGGER);
    await turn.update({ sessionUpdate: 'config_option_update', configOptions: turn.options() });
    await turn.say(`now=${turn.config.mode}`);
    return 'end_turn';
  }
  if (turn.text.includes(MODE_WAIT_TRIGGER)) {
    const wanted = argAfter(turn.text, MODE_WAIT_TRIGGER);
    for (let waited = 0; waited < 5_000 && turn.config.mode !== wanted; waited += 25) {
      if (turn.signal.aborted) return 'cancelled';
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await turn.say(`switched=${turn.config.mode}`);
    return 'end_turn';
  }
  return null;
}
