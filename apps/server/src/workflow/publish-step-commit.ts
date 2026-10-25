import { runGit } from '../ship/git.ts';
import type { TurnDeps, TurnResult } from './agent-turn.ts';
import { closeMessage } from './execute-run.ts';
import { publishPrompt, type PublishReason } from './publish-prompt.ts';
import { promptAgain, type SecondPrompt } from './publish-step-again.ts';
import { holdReplyText } from './publish-step-lead.ts';
import { notePublish, notPublishedLine, withWorkMessage } from './publish-step-lines.ts';

async function head(root: string): Promise<string | null> {
  const result = await runGit(root, ['rev-parse', '--verify', 'HEAD']);
  return result.code === 0 ? result.stdout.trim() || null : null;
}

export async function commitWithoutRemote(
  deps: TurnDeps,
  turn: SecondPrompt & { reply: TurnResult },
  root: string,
  branch: string,
  reason: PublishReason,
): Promise<TurnResult> {
  if (turn.control.signal.aborted) return turn.reply;
  const status = await runGit(root, ['status', '--porcelain']);
  const prompt = publishPrompt({
    branch,
    reason,
    unpublishedWork: status.code === 0 && status.stdout.trim().length > 0,
    draftAsked: false,
    localOnly: true,
  });
  if (!prompt) return turn.reply;
  const before = await head(root);
  if (turn.control.signal.aborted) return turn.reply;
  await closeMessage(turn.append, await withWorkMessage(turn.append, turn.reply), true);
  const held = holdReplyText(turn.append);
  const said = await promptAgain(deps, { ...turn, append: held.append }, prompt);
  if (said.outcome === 'lease_lost') return said;
  if (said.outcome !== 'succeeded') {
    const line = notPublishedLine(said);
    await notePublish(turn.append, line);
    return held.ledBy({ ...said, outcome: 'succeeded', error: null }, line);
  }
  const after = await head(root);
  const currentBranch = await runGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const onChatBranch = currentBranch.code === 0 && currentBranch.stdout.trim() === branch;
  const line =
    !after || !before
      ? 'The local commit state could not be verified. This project has no remote.'
      : after !== before
        ? onChatBranch
          ? `HEAD changed to ${after.slice(0, 7)} on ${branch}. This project has no remote.`
          : `HEAD changed to ${after.slice(0, 7)}, but the chat branch could not be confirmed. This project has no remote.`
        : 'No additional commit was made. This project has no remote.';
  await notePublish(turn.append, line);
  return held.ledBy(said, line);
}
