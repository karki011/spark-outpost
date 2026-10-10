import { oneLine } from './chat-prompt-text.ts';

export type PublishReason = 'full-auto' | 'asked' | 'follow-up';

export interface PublishPromptFacts {
  branch: string;
  unpublishedWork: boolean;
  reason: PublishReason | null;
  draftAsked: boolean;
}

export const PUBLISH_PROMPT_HEADING = '## Publish this change';

const HOOKS =
  "Never skip hooks (no `--no-verify`). If the push's pre-push check fails, fix what your change caused and push again; when you cannot fix it, stop and tell the user once exactly what is needed.";

const LIMITS =
  'Never force-push, push any other branch or the base branch, or change git remotes; nothing merges.';

function pushStep(branch: string): string {
  return `push this chat's own branch with the \`spark_push\` tool (without that tool use \`git push origin ${branch}\`)`;
}

function followUpLines(branch: string): string[] {
  return [
    `The fix for this pull request's feedback is finished. If you changed files, commit them and ${pushStep(branch)}; the pull request updates itself. If you changed nothing, do nothing.`,
    "Don't open another pull request, reply on GitHub or resolve threads: Spark posts your per-item lines as the replies.",
    `${LIMITS} ${HOOKS}`,
    'End your reply with the same per-item lines as before.',
  ];
}

function firstPublishLines(branch: string, draftAsked: boolean): string[] {
  return [
    `The work on this task is finished. Publish it now, in this turn, and change nothing else: commit it, ${pushStep(branch)} and open its pull request with \`gh pr create\`, or with \`spark_pull_request\` when you have that tool.`,
    'Open exactly one pull request for the whole change; when one already exists for this branch, push to it and update its description instead of opening another.',
    ...(draftAsked ? ['Open it as a draft (`gh pr create --draft`, or `draft: true`).'] : []),
    `${LIMITS} ${HOOKS}`,
    'If the branch is pushed but no pull request could be opened, say so plainly. End your reply with the pull request link.',
  ];
}

export function publishPrompt(facts: PublishPromptFacts): string | null {
  if (!facts.unpublishedWork || facts.reason === null) return null;
  const branch = oneLine(facts.branch).replaceAll('`', '');
  if (!branch) return null;
  const lines =
    facts.reason === 'follow-up'
      ? followUpLines(branch)
      : firstPublishLines(branch, facts.draftAsked);
  return [PUBLISH_PROMPT_HEADING, ...lines].join('\n');
}
