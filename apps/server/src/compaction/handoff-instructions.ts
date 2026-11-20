export const HANDOFF_SECTIONS = [
  'Goal and scope: the task in one or two lines, and any scope decision (what is in, what is out).',
  'State: what is done and verified, with pull request, commit and ticket ids; what is in flight and where (branch, worktree, background job).',
  'Next steps: in order, each with its gate or blocker.',
  "Your decisions: the user's decisions and constraints, quoted or closely paraphrased, each with its date when you know it. Keep every one; summaries lose these most.",
  'Open questions: what is still undecided or owed, and to whom.',
  'Gotchas: traps hit in this chat and their fix.',
  'Loose ends: uncommitted changes and files written outside git.',
] as const;

export function handoffInstructions(liveState: string, today: Date): string {
  const sections = HANDOFF_SECTIONS.map((line) => `- ${line}`).join('\n');
  const verify = liveState
    ? 'You cannot run commands while compacting. Take live state from the block below, which Spark checked just now, and mark any other claim about branches, pull requests, checks or files as unverified.'
    : 'You cannot run commands while compacting. Mark any claim about branches, pull requests, checks or files that you have not seen confirmed recently as unverified.';
  return [
    'Write the summary as a handoff the next context can work from. Keep it short: only what cannot be recovered from git, GitHub, tickets or files on disk.',
    `Use these sections, in this order, and leave out any that would be empty:\n${sections}`,
    `${verify} Today is ${today.toISOString().slice(0, 10)}.`,
    liveState,
  ]
    .filter(Boolean)
    .join('\n\n');
}
