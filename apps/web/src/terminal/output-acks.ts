import { TERMINAL_ACK_BYTES } from '@spark-outpost/contracts';

export function createAckCounter(
  send: (bytes: number) => void,
  every: number = TERMINAL_ACK_BYTES,
): (bytes: number) => void {
  let pending = 0;
  return (bytes) => {
    pending += bytes;
    if (pending < every) return;
    send(pending);
    pending = 0;
  };
}
