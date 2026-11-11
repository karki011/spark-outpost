export const DIFF_BUDGET = 64 * 1024;

export interface DiffBudget {
  cut(text: string, most?: number): string;
  readonly left: number;
  readonly truncated: boolean;
}

const HIGH_SURROGATE = /[\uD800-\uDBFF]$/;

function wholeCharacters(text: string): string {
  return HIGH_SURROGATE.test(text) ? text.slice(0, -1) : text;
}

export function createDiffBudget(limit = DIFF_BUDGET): DiffBudget {
  let budget = limit;
  let truncated = false;
  return {
    cut(text, most = budget) {
      const room = Math.min(budget, most);
      if (text.length <= room) {
        budget -= text.length;
        return text;
      }
      truncated = true;
      const kept = wholeCharacters(text.slice(0, Math.max(0, room)));
      budget -= room;
      return kept;
    },
    get left() {
      return budget;
    },
    get truncated() {
      return truncated;
    },
  };
}
