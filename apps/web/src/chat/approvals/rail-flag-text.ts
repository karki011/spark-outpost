import type { RailFlag } from '@spark-outpost/contracts';

type FlagFacts = Pick<RailFlag, 'rail' | 'inside' | 'originals'>;

export function flagNote(flag: FlagFacts): string {
  const base = "The agent did this without asking. Spark didn't stop the run.";
  if (flag.rail === 'other_piece') {
    return `${base} The change was kept and the file's owner was told.`;
  }
  return !flag.inside && flag.originals.length === 0 ? `${base} Spark can't revert this.` : base;
}
