import { egressTarget, type Egress } from './egress.ts';

const SHOWN = 3;

export function observedList(observed: readonly string[]): string {
  const shown = observed.slice(0, SHOWN);
  const rest = observed.length - shown.length;
  const joined =
    shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : (shown[0] ?? '');
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : joined;
}

export function taintReason(observed: readonly string[], egress: Egress): string {
  return `This run read ${observedList(observed)} earlier; sending data ${egressTarget(egress)} needs your OK`;
}
