export const REQUEST_LIMIT = 8_000;
export const PATCH_LIMIT = 24_000;
const CHECK_OUTPUT_LIMIT = 3_000;

export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
  origin?: 'task' | 'before' | 'both';
}

export function cap(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length > limit
    ? `${trimmed.slice(0, limit)}\n[cut at ${limit} characters]`
    : trimmed;
}

export function section(title: string, body: string): string {
  return `## ${title}\n${body}`;
}

const PATH_TOKEN =
  /(?:^|[\s`'"(])((?:[\w.-]+\/)+[\w.-]+\.\w+|[\w-]+\.(?:ts|tsx|js|jsx|json|md|sql|css|html|py|rs|go|yaml|yml|toml))(?=$|[\s`'"),:;]|\.(?:\s|$))/g;

export function namedFiles(steps: readonly string[]): string[] {
  const found = new Set<string>();
  for (const step of steps) {
    for (const match of step.matchAll(PATH_TOKEN)) found.add(match[1]!);
  }
  return [...found].slice(0, 20);
}

const PUSH_HOOK_RULE =
  "Never skip hooks (no `--no-verify`). If the push's pre-push check or the pull request step fails, read its output and deal with it in this turn: when dependencies are missing or stale, run the project's reproducible install (for example `pnpm install --frozen-lockfile`) and push again; when your change caused it (lint, types, tests, a build), fix it and push again. When you cannot fix it (an expired registry or GitHub login, no network, a check that fails on the base branch too), stop and tell the user once exactly what is needed, with the last lines of the output. Push at most 3 times in a turn.";

function publishSteps(branch: string): string {
  return `commit it, push this chat's own branch with the \`spark_push\` tool (Spark runs the push with the user's own shell logins so the repository's pre-push check can pass; without that tool use \`git push origin ${branch}\`) and open its pull request with \`gh pr create\` (\`gh pr edit\` works on that PR, and reading any pull request, its checks and runs with \`gh\` is fine), or with \`spark_pull_request\` when you have that tool. Never force-push, push any other branch or the base branch, or change git remotes; nothing merges. ${PUSH_HOOK_RULE}`;
}

const PUBLISH_REPORT_RULE =
  'Spark records the pull request from the command output, so give the user its link. If the branch is pushed but no pull request could be opened, say so plainly. Say a card is waiting only when a tool returned waiting_for_user.';

export function pullBaseLine(base: string): string {
  return `Open the pull request against ${base}: \`gh pr create --base ${base}\` (\`spark_pull_request\` already uses that base). Leave the base of a pull request that already exists as it is.`;
}

function baseLines(base: string | null | undefined): string[] {
  return base ? [pullBaseLine(base)] : [];
}

export function mainAgentPublishNote(branch: string, base: string | null = null): string {
  return [
    `The user asked for this to be pushed or opened as a pull request. Do it yourself: ${publishSteps(branch)}`,
    ...baseLines(base),
    PUBLISH_REPORT_RULE,
  ].join(' ');
}

export const PUBLISH_TURN_HEADING = '## Publish this change';

export interface FailingCheck {
  command: string;
  outcome: string;
  exitCode: number | null;
  outputTail: string;
}

function failureStatus(check: FailingCheck): string {
  return `exited ${check.exitCode ?? 'with an error'}`;
}

export function checkFailureText(checks: readonly FailingCheck[]): string {
  const share = Math.floor(CHECK_OUTPUT_LIMIT / Math.max(1, checks.length));
  return checks
    .map((check) => {
      const tail = check.outputTail.trim();
      const shown = tail.length > share ? `…${tail.slice(tail.length - share)}` : tail;
      return `\`${check.command}\` ${failureStatus(check)}:\n\`\`\`text\n${shown || '(no output)'}\n\`\`\``;
    })
    .join('\n\n');
}
