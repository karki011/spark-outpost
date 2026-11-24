import { onWindows } from '../desktop/desktop-bridge.ts';

export interface UnlockCopy {
  name: string;
  failed: string;
  recoverLine: string;
  recoverButton: string;
}

const TURNS_OFF = 'The privacy screen turns off until you set a new code.';

export function unlockCopy(windows = onWindows()): UnlockCopy {
  const name = windows ? 'Windows Hello' : 'Touch ID';
  return {
    name,
    failed: `${name} didn’t unlock Spark. Try again or enter your code.`,
    recoverLine: windows
      ? `Confirm with Windows Hello. ${TURNS_OFF}`
      : `Confirm with your Mac password or Touch ID. ${TURNS_OFF}`,
    recoverButton: windows ? 'Use Windows Hello…' : 'Use Mac password…',
  };
}
