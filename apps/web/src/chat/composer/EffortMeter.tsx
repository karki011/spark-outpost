import type { CapabilityOption } from '@spark-outpost/contracts';
import { meterLevel } from './model-options.ts';

const HEIGHTS = [4, 6, 8, 11];

export function EffortMeter({
  efforts,
  effort,
}: {
  efforts: CapabilityOption[];
  effort: string | null;
}) {
  const level = meterLevel(efforts, effort, HEIGHTS.length);
  return (
    <span className="meter" aria-hidden="true">
      {HEIGHTS.map((height, index) => (
        <i key={height} style={{ height }} className={index < level ? 'on' : undefined} />
      ))}
    </span>
  );
}
