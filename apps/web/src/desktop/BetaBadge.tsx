import { isBetaVersion } from '@spark-outpost/contracts';
import { sparkDesktop } from './desktop-bridge.ts';

export function BetaBadge({ version }: { version: string }) {
  if (sparkDesktop()?.platform === 'win32') return <span className="beta-badge">Alpha</span>;
  if (!isBetaVersion(version)) return null;
  return <span className="beta-badge">Beta</span>;
}
