import { isBetaVersion } from '@spark-outpost/contracts';

export function BetaBadge({ version }: { version: string }) {
  if (!isBetaVersion(version)) return null;
  return <span className="beta-badge">Beta</span>;
}
