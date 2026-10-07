export const NEED_OPTIONS = ['question', 'small_change', 'build', 'needs_you'] as const;
export type NeedOption = (typeof NEED_OPTIONS)[number];

export const NEED_ACT_AT = 0.8;

export const NEED_QUESTION = 'What does `task` need from the agent? Pick one.';

export const NEED_CRITERIA: Record<NeedOption, { what: string; not_for: string }> = {
  question: {
    what: 'An answer, an explanation, a status report, a review of options or a written plan, with no files changed',
    not_for: 'Any request to change, add, fix or remove something',
  },
  small_change: {
    what: 'One small, clearly stated change, or a short follow-up to the work described in `task_summary`',
    not_for: 'Work that spans several features or areas, or a request that is unclear',
  },
  build: {
    what: 'A change with several parts: a feature, a refactor across files, or anything that needs its own plan',
    not_for: 'A single small edit, or a question',
  },
  needs_you: {
    what: 'A change is wanted, but what to change or where cannot be told from `task` and the earlier messages',
    not_for:
      'A request that names what to change, even briefly, or a follow-up that the earlier messages make clear',
  },
};

export function needQuestion() {
  return { type: 'choice' as const, instructions: NEED_QUESTION, criteria: NEED_CRITERIA };
}
