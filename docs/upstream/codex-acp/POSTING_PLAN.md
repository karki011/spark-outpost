# Posting plan for the codex-acp contributions

> **Nothing here has been run.** These are the exact commands that would post everything, in order, from the user's own GitHub account (`gh` is logged in as `karki011`). Review the texts and the two `.patch` files first, then run the steps by hand, or ask Claude to run them after you approve.

## What gets posted

| #   | What                                                                 | Source                                                                        | Target                        |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------- |
| 1   | Fork                                                                 | –                                                                             | `karki011/codex-acp`          |
| 2   | Push two branches                                                    | local clone (below)                                                           | the fork                      |
| 3   | Issue: ask-every-time mode                                           | [issue-ask-always-mode.md](issue-ask-always-mode.md)                          | agentclientprotocol/codex-acp |
| 4   | Issue: continue-on-reject option                                     | [issue-decline-option.md](issue-decline-option.md)                            | agentclientprotocol/codex-acp |
| 5   | Draft PR `feat: add ask-every-time session mode`                     | [pr-ask-always-mode.md](pr-ask-always-mode.md), branch `feat/ask-always-mode` | closes issue 3                |
| 6   | Draft PR `feat: offer decline before cancel for clients that opt in` | [pr-decline-option.md](pr-decline-option.md), branch `feat/decline-option`    | closes issue 4                |
| 7   | Comment on #447 (per-turn usage)                                     | [comment-turn-usage.md](comment-turn-usage.md)                                | existing issue #447           |

Only the text between `<!-- BODY BELOW -->` and `<!-- END BODY -->` in each file is posted. The optional openai/codex issue at the end of `issue-decline-option.md` is **not** part of this plan.

## Before you run it

- The clone with both branches is `$CLONE` below (in the Claude scratchpad, so it disappears when the session's temp files are cleaned). If it's gone, re-create the branches from the patch files: `git clone https://github.com/agentclientprotocol/codex-acp.git && cd codex-acp && git checkout -b feat/ask-always-mode bf37821 && git am <drafts>/feat-ask-always-mode.patch && git checkout -b feat/decline-option bf37821 && git am <drafts>/feat-decline-option.patch`.
- Both commits are authored as `Subash karki <karki011@gmail.com>` (no co-author trailer). Change the author with `git commit --amend --reset-author` (after `git config user.email …`) if you prefer your GitHub noreply address.
- Check that `main` hasn't moved in a way that conflicts: `git -C "$CLONE" fetch origin && git -C "$CLONE" log --oneline bf37821..origin/main`. If it has, rebase both branches and rerun `npm run typecheck && CI=true npm test && npm run build`.

## Commands

```bash
set -euo pipefail
DRAFTS="$HOME/Documents/spark-outpost/docs/upstream/codex-acp"
CLONE="/private/tmp/claude-501/-Users-hmk-Downloads-spark-outpost/de4f337c-37ca-43f6-b4b8-456b09d97ef9/scratchpad/upstream-codex-acp/codex-acp"
REPO="agentclientprotocol/codex-acp"
ME="karki011"
TMP="$(mktemp -d)"

# Extracts the postable body of a draft file.
body() { awk '/^<!-- END BODY -->$/{exit} f; /^<!-- BODY BELOW -->$/{f=1}' "$1"; }

# 1. Fork (no clone; the local clone already has the branches).
gh repo fork "$REPO" --clone=false

# 2. Push both branches to the fork.
git -C "$CLONE" remote add fork "https://github.com/$ME/codex-acp.git" 2>/dev/null || true
git -C "$CLONE" push -u fork feat/ask-always-mode feat/decline-option

# 3. Issue: ask-every-time mode.
body "$DRAFTS/issue-ask-always-mode.md" > "$TMP/issue-ask.md"
ASK_ISSUE_URL=$(gh issue create --repo "$REPO" \
  --title "No mode asks before every command and file edit (an \`untrusted\`-style preset)" \
  --body-file "$TMP/issue-ask.md")
ASK_ISSUE=${ASK_ISSUE_URL##*/}

# 4. Issue: continue-on-reject option (links the first issue).
body "$DRAFTS/issue-decline-option.md" | sed "s/#<ask-always issue>/#$ASK_ISSUE/g" > "$TMP/issue-decline.md"
DECLINE_ISSUE_URL=$(gh issue create --repo "$REPO" \
  --title "Rejecting a command or file edit can only end the turn when Codex doesn't offer \`decline\`" \
  --body-file "$TMP/issue-decline.md")
DECLINE_ISSUE=${DECLINE_ISSUE_URL##*/}

# 5. Draft PR: ask-every-time mode.
body "$DRAFTS/pr-ask-always-mode.md" \
  | sed -e "s/#<ask-always issue>/#$ASK_ISSUE/g" -e "s/#<decline issue>/#$DECLINE_ISSUE/g" > "$TMP/pr-ask.md"
gh pr create --repo "$REPO" --draft --base main --head "$ME:feat/ask-always-mode" \
  --title "feat: add ask-every-time session mode" \
  --body-file "$TMP/pr-ask.md"

# 6. Draft PR: continue-on-reject option.
body "$DRAFTS/pr-decline-option.md" \
  | sed -e "s/#<ask-always issue>/#$ASK_ISSUE/g" -e "s/#<decline issue>/#$DECLINE_ISSUE/g" > "$TMP/pr-decline.md"
gh pr create --repo "$REPO" --draft --base main --head "$ME:feat/decline-option" \
  --title "feat: offer decline before cancel for clients that opt in" \
  --body-file "$TMP/pr-decline.md"

# 7. Comment on #447 (per-turn usage). No new issue or PR for this topic.
body "$DRAFTS/comment-turn-usage.md" > "$TMP/comment-447.md"
gh issue comment 447 --repo "$REPO" --body-file "$TMP/comment-447.md"

echo "Issues: #$ASK_ISSUE #$DECLINE_ISSUE"
```

## Checks after posting

- Every placeholder was replaced: `grep -n '<ask-always issue>\|<decline issue>' "$TMP"/*.md` finds nothing.
- `conventional-prs.yml` passes on both PRs (the titles are `feat:`), and CI (`typecheck → test → bundle:all`) is green. `bundle:all` needs bun and wasn't run locally.
- Mark a PR ready for review (`gh pr ready <n> --repo "$REPO"`) only after the maintainers answer its issue. The wire-value question (`untrusted`) and the opt-in design are both open questions in the issues.
