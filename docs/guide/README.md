# Spark Outpost user guide

This folder is the single source for the user guide. The app bundles these pages into its **Docs** page, Spark's agents read them through the `spark_docs` tool, and a website can render the same files.

`pnpm check:docs` (part of `pnpm check`) enforces the rules on this page.

## Who reads it, and to do what

`welcome.md`, the Docs landing page, lists at most 12 tasks in four groups. Every other page is reached from the sidebar, search or a link.

| Reader                                    | Top tasks                                                                       | Starts in                    |
| ----------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------- |
| New user setting up                       | Connect a provider, send a first message, connect GitHub or a tracker           | Get started                  |
| Daily user working in chats               | Start a chat, set the mode, answer cards, review changes, open a PR             | Chats, Projects and shipping |
| Power user running outposts and Full auto | Set autonomy, plan first, outposts and stories, PR feedback, Sparks, the island | Chats, Mac app and providers |
| Someone worried about safety or privacy   | See what always asks, what leaves the computer, what Jev reads                  | Understand Spark, Reference  |
| Someone fixing a problem                  | Match a symptom to a fix, send diagnostics, start over                          | Help                         |

## Page types

Every page has one job and one `type`. Docs shows the type as a badge, and `spark_docs` can filter by it.

| `type`            | Job                         | Shape                                                                                           | Word cap |
| ----------------- | --------------------------- | ----------------------------------------------------------------------------------------------- | -------- |
| `start`           | One setup step, in sequence | Outcome and "About N minutes.", numbered steps, closing `**Next:**` link                        | 200      |
| `how-to`          | One job, start to finish    | Outcome and "About N minutes." first, numbered steps with the app's labels in bold, `**Next:**` | 300      |
| `concept`         | Explain how something works | A two-sentence answer first, then tables. Link to how-tos; no step lists                        | 300      |
| `reference`       | Look something up           | Tables, one line per row                                                                        | 600      |
| `troubleshooting` | Fix a symptom               | A table row or a list per symptom: **You see**, **Why**, **Fix**                                | 350      |
| `whats-new`       | Say what changed            | One table row per change: what changed, what to do. Newest first                                | 400      |

Words are counted without frontmatter, table rules, image syntax and link targets.

## Sections

Sections are the seven groups in the Docs sidebar. `order` sorts pages; the hundreds digit groups a section, and sections appear in the order of their first page.

| Section               | Orders | Holds                                                                |
| --------------------- | ------ | -------------------------------------------------------------------- |
| Get started           | 100s   | The landing page, setup, connecting a provider                       |
| Chats                 | 200s   | Working in a chat: model and mode, cards, changes, terminals, Sparks |
| Projects and shipping | 300s   | Worktrees, `.sparkignore`, the Map, Ship, PR follow-up, tickets      |
| Mac app and providers | 400s   | Spark Island, updates, Mac privacy, providers, models and Jev's key  |
| Understand Spark      | 500s   | Concepts                                                             |
| Reference             | 600s   | Tables                                                               |
| Help                  | 700s   | Troubleshooting and What's new                                       |

## How a page is written

- One Markdown file per page. The file name is the page id and the link: `plan-card.md` opens at `#/docs/plan-card`.
- Frontmatter, all five fields required:

  ```yaml
  ---
  title: Answer a plan
  section: Chats
  type: how-to
  order: 224
  summary: One sentence, up to 170 characters, shown under the title, in search and to agents.
  ---
  ```

- Plain Markdown with GitHub tables. No `#` heading in the body; use `##` for parts of the page and `###` below them. Docs lists the `##` headings under **On this page** when there are three or more.
- Heading links follow GitHub's rules: `## Hold to confirm` is `#hold-to-confirm`. Link to another page with a relative link: `[protected paths](protected-paths.md#secret-files)`.
- Callouts are blockquotes that start with a bold word: `> **Tip:**`, `> **Note:**`, `> **Important:**`. At most one Tip per page.
- A closing `**Next:** [Title](page.md)` link names the next page in a sequence, with that page's exact title. Docs shows it as the Next button.
- Write in second person, plain words, no marketing. Use the app's exact labels in **bold**. Keep paragraphs to 40 words and steps to about 15.
- Say a thing once. Link to the page that owns it instead of explaining it again.
- Prefer a table or a screenshot to a paragraph. Leave out internals the reader can't act on.
- Steps of one job belong on one page. Don't split a page until it passes its cap.
- Jev is optional: a page that mentions Jev says what happens without it.
- Verify behaviour in the source before you write it down.

## Screenshots

Screenshots live in `images/` as `<name>-light.png` and `<name>-dark.png`. Pages link the light one; the app swaps in the dark one when the theme is dark. Put one at the step that needs it.

Regenerate them with `pnpm docs:screenshots` (`tests/browser/docs-shots*.spec.ts`). It runs the app against a seeded demo test database, never your real data. An image no page shows fails the check, so delete it.

## Moving, merging or renaming a page

Old ids are not kept. In the same commit, update every link to the page:

1. Links between pages. `pnpm check:docs` fails on a broken page or heading link.
2. In-app links (`apps/web/src/ui/DocLink.tsx` callers). A unit test fails when one points at a page or heading that doesn't exist.
3. Page ids in tests and in `tests/browser/docs-shots*.spec.ts`.

In the app, a link to a missing heading opens the top of its page, and a link to a missing page opens the landing page.

## Keeping docs current

A code change needs a doc change in the same commit when it adds, renames or removes any of these:

| Change in the app                           | Update                                                           |
| ------------------------------------------- | ---------------------------------------------------------------- |
| A UI label, button or status a page quotes  | Every page that quotes it; `statuses-and-limits.md` for a status |
| A setting or Settings section               | `settings.md`, and the how-to that uses it                       |
| A card                                      | `cards.md`, and the how-to that answers it                       |
| A Spark tool                                | `spark-tools.md`                                                 |
| An agent mode or autonomy level             | `modes-and-levels.md`, `agent-mode.md`, `spark-autonomy.md`      |
| A protected path or publish rule            | `protected-paths.md`                                             |
| What is sent to a provider, Jev or the team | `privacy-and-secrets.md`, `jev.md`, `map.md`, `mac-privacy.md`   |
| A keyboard shortcut or a limit              | `keyboard-shortcuts.md`, `statuses-and-limits.md`                |
| Anything a user can see                     | One row in `whats-new.md`: what changed and what to do           |

`pnpm check:docs` fails when:

- a page has bad frontmatter, an unknown `type` or a repeated title;
- a page is over its word cap, has a paragraph over 40 words, a `#` heading or a second Tip;
- a how-to lacks its time estimate or numbered steps, a how-to or start page lacks its `**Next:**` link, or a Next link's text isn't the target's title;
- a link to a page or heading is broken;
- a table has no header row, or a row has a different number of cells than its header;
- a shown image is missing its light or dark file, or an image is shown nowhere;
- a Spark tool has no entry in `spark-tools.md`, or a Settings section has none in `settings.md`;
- `spark_docs` would clip the page list or a page (60 list items, 4,000 characters per section, 20,000 per answer).

## Measuring

There is no analytics service. Docs keeps searches that found nothing in the browser's local storage (the newest 30), and **Send feedback** lists the latest ten in the draft, where the user can read and delete them before sending. Review those lists when feedback arrives, and add the missing page, heading or wording.

Once a quarter, read `welcome.md` against the app and remove tasks that no longer exist.
