export interface AnchorJump {
  anchor: string;
  released: boolean;
}

export interface AnchorState {
  active: string | null;
  jump: AnchorJump | null;
}

export type AnchorEvent =
  | { type: 'jump'; anchor: string }
  | { type: 'band'; inView: string | null }
  | { type: 'scrollend'; landed: boolean; inView: string | null }
  | { type: 'takeover'; inView: string | null }
  | { type: 'timeout'; landed: boolean; inView: string | null };

export const NO_ANCHOR: AnchorState = { active: null, jump: null };

function following(state: AnchorState, inView: string | null, jump: AnchorJump | null) {
  return { active: inView ?? state.active, jump };
}

export function nextAnchorState(state: AnchorState, event: AnchorEvent): AnchorState {
  if (event.type === 'jump') {
    return { active: event.anchor, jump: { anchor: event.anchor, released: false } };
  }
  const { jump } = state;
  if (event.type === 'band') {
    return jump && !jump.released ? state : following(state, event.inView, jump);
  }
  if (!jump) return state;
  const released = { anchor: jump.anchor, released: true };
  if (event.type === 'takeover') return following(state, event.inView, released);
  if (event.landed) return { active: jump.anchor, jump: null };
  if (event.type === 'timeout') return following(state, event.inView, null);
  return following(state, event.inView, released);
}
