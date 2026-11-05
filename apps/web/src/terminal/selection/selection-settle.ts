export interface SettleState {
  pointerDown: boolean;
  changedWhileDown: boolean;
}

export type SettleEvent = 'pointer-down' | 'pointer-up' | 'changed';

export const SETTLE_IDLE: SettleState = { pointerDown: false, changedWhileDown: false };

export function settle(
  state: SettleState,
  event: SettleEvent,
): { state: SettleState; settled: boolean } {
  if (event === 'pointer-down') {
    return { state: { pointerDown: true, changedWhileDown: false }, settled: false };
  }
  if (event === 'pointer-up') {
    return { state: SETTLE_IDLE, settled: state.pointerDown && state.changedWhileDown };
  }
  if (state.pointerDown) {
    return { state: { pointerDown: true, changedWhileDown: true }, settled: false };
  }
  return { state, settled: true };
}
