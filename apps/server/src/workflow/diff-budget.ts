export const DIFF_BUDGET = 64 * 1024;

export interface DiffBudget {
  cut(text: string): string;
  readonly truncated: boolean;
}

export function createDiffBudget(limit = DIFF_BUDGET): DiffBudget {
  let budget = limit;
  let truncated = false;
  return {
    cut(text) {
      if (text.length <= budget) {
        budget -= text.length;
        return text;
      }
      truncated = true;
      const kept = text.slice(0, Math.max(0, budget));
      budget = 0;
      return kept;
    },
    get truncated() {
      return truncated;
    },
  };
}
