export type LawName = 'chesterton' | 'goodhart';

export type LawKind =
  | 'file'
  | 'symbol'
  | 'test'
  | 'guard'
  | 'block'
  | 'claim'
  | 'weakened_test'
  | 'snapshot'
  | 'config'
  | 'scope';

export interface LawFinding {
  law: LawName;
  kind: LawKind;
  path: string | null;
  text: string;
}

export interface LawFacts {
  request: string;
  replies: readonly string[];
  plan: readonly string[];
}

export function code(text: string): string {
  return `\`${text.replaceAll('`', "'")}\``;
}
