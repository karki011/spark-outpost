export interface CloneProgress {
  phase: string;
  percent: number | null;
}

interface Stage {
  pattern: RegExp;
  phase: string;
  from: number;
  to: number;
}

const STAGES: Stage[] = [
  {
    pattern: /^remote: (?:Enumerating|Counting|Compressing) objects/,
    phase: 'Preparing on the server',
    from: 0,
    to: 5,
  },
  { pattern: /^Receiving objects:/, phase: 'Receiving objects', from: 5, to: 80 },
  { pattern: /^Resolving deltas:/, phase: 'Resolving deltas', from: 80, to: 95 },
  { pattern: /^(?:Updating|Checking out) files:/, phase: 'Checking out files', from: 95, to: 100 },
];

const PERCENT = /:\s+(\d{1,3})%/;

export const CONNECTING: CloneProgress = { phase: 'Connecting', percent: null };

export function parseProgressLine(line: string): CloneProgress | null {
  const text = line.trim();
  const stage = STAGES.find((entry) => entry.pattern.test(text));
  if (!stage) return null;
  const share = Math.min(100, Number(PERCENT.exec(text)?.[1] ?? 0));
  return {
    phase: stage.phase,
    percent: Math.round(stage.from + ((stage.to - stage.from) * share) / 100),
  };
}

export function advance(current: CloneProgress, line: string): CloneProgress {
  const next = parseProgressLine(line);
  if (!next) return current;
  return (next.percent ?? 0) >= (current.percent ?? 0) ? next : current;
}
