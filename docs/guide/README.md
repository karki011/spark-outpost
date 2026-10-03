# Spark Outpost user guide

This folder is the single source for the user guide. The app bundles these pages into its **Docs** page, Spark's agents read them through the `spark_docs` tool, and a website can render the same files.

`pnpm check:docs` (part of `pnpm check`) enforces the rules on this page.

## Who reads it, and to do what

The structure follows these five readers and their top tasks. `welcome.md`, the Docs landing page, lists the same tasks as links.

| Reader                                  | Top tasks                                                                                                          | Starts in                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| New user setting up                     | Connect a provider, pick defaults, send a first message, connect GitHub or a tracker                               | Get started                            |
| Daily user working in chats             | Start a chat, change the mode, answer approval and plan cards, review or revert changes, queue messages, open a PR | Chats, Ship and pull requests, Tickets |
| Power user running crews and Full auto  | Set autonomy, steer pieces, watch and message the crew, let Spark handle PR feedback, make Sparks, use the island  | Chats, Crew and pieces, Mac app        |
| Someone worried about safety or privacy | See what always asks, what leaves the computer, what Jev reads, keep files and keys away from agents               | Understand Spark, Reference            |
| Someone fixing a problem                | Match a symptom to a fix, send diagnostics, start over                                                             | Troubleshooting                        |

## Page types

Every page has one job and one `type`. Docs shows the type as a badge, and `spark_docs` can filter by it.

| `type`            | Job                         | Shape                                                                                                                                              | Word cap |
| ----------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `start`           | One setup step, in sequence | Outcome and "About N minutes.", numbered steps, closing `**Next:**` link                                                                           | 300      |
| `how-to`          | Solve exactly one task      | First paragraph says the outcome and "About N minutes.", numbered steps with the app's labels in bold, closing `**Next:**` link. Aim for 300 words | 450      |
| `concept`         | Explain how something works | A two-sentence answer first, then a table. Link to how-tos; no step lists                                                                          | 400      |
| `reference`       | Look something up           | Tables: settings, modes, cards, protected paths, tools, shortcuts, statuses, limits, glossary                                                      | 800      |
| `troubleshooting` | Fix one symptom per entry   | Per symptom: **You see**, **Why**, **Fix**, **Still stuck**, as a list or one table row                                                            | 450      |
| `whats-new`       | Say what changed            | A table: what changed, who's affected, what to do. Newest first                                                                                    | 600      |

Words are counted without frontmatter, table rules, image syntax and link targets.

## Sections

Sections are the product areas people browse by. `order` sorts pages; the hundreds digit groups a section, and sections appear in the order of their first page.

| Section                | Orders  | Holds                                             |
| ---------------------- | ------- | ------------------------------------------------- |
| Get started            | 100s    | The landing page and the setup sequence           |
| Chats                  | 200s    | How-tos for working in a chat                     |
| Projects and the Map   | 300s    | Worktrees, the allowlist, `.sparkignore`, the Map |
| Crew and pieces        | 400s    | Agent TV, messaging the crew, pieces              |
| Ship and pull requests | 500s    | Ship, PR follow-up                                |
| Tickets and GitHub     | 600s    | Connectors, the Tickets inbox                     |
| Mac app                | 700–749 | Spark Island, updates, Mac privacy                |
| Providers and keys     | 750–799 | Providers, models, keys                           |
| Understand Spark       | 800s    | Concepts                                          |
| Reference              | 900–949 | Tables                                            |
| Troubleshooting        | 950–989 | An index page and one page per group of symptoms  |
| What's new             | 990s    | Release notes                                     |

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
- Write in second person, plain words, no marketing. Use the app's exact labels in **bold**. Keep paragraphs to three lines (60 words).
- Say a thing once. Link to the page that owns it instead of explaining it again.
- Jev is optional: a page that mentions Jev says what happens without it.
- Verify behaviour in the source before you write it down.

## Screenshots

Screenshots live in `images/` as `<name>-light.png` and `<name>-dark.png`. Pages link the light one; the app swaps in the dark one when the theme is dark. Put one at the step that needs it.

Regenerate them with `pnpm docs:screenshots` (`tests/browser/docs-shots*.spec.ts`). It runs the app against a seeded demo test database, never your real data. An image no page shows fails the check, so delete it.

## Moving or renaming a page

Old links must keep working: in-app links, `#/docs/...` deep links and agent lookups.

1. Add the old id, or `old-page#old-heading`, to `packages/contracts/src/guide-redirects.ts`, pointing at the new page or heading.
2. Point in-app links (`apps/web/src/ui/DocLink.tsx` callers) straight at the new target. A unit test rejects in-app links that lean on a redirect.

A heading that has no redirect opens the top of its page.

## Keeping docs current

A code change needs a doc change in the same commit when it adds, renames or removes any of these:

| Change in the app                           | Update                                                              |
| ------------------------------------------- | ------------------------------------------------------------------- |
| A UI label, button or status a page quotes  | Every page that quotes it; `statuses-and-limits.md` for a status    |
| A setting or Settings section               | `settings.md`, and the how-to that uses it                          |
| A card                                      | `cards.md`, and the how-to that answers it                          |
| A Spark tool                                | `spark-tools.md`                                                    |
| An agent mode or autonomy level             | `modes-and-levels.md`, `agent-mode.md`, `spark-autonomy.md`         |
| A protected path or publish rule            | `protected-paths.md`                                                |
| What is sent to a provider, Jev or the team | `privacy-and-secrets.md`, `jev.md`, `mac-privacy.md`                |
| A keyboard shortcut or a limit              | `keyboard-shortcuts.md`, `statuses-and-limits.md`                   |
| Anything a user can see                     | One row in `whats-new.md`: what changed, who's affected, what to do |

`pnpm check:docs` fails when:

- a page has bad frontmatter, an unknown `type` or a repeated title;
- a page is over its word cap, has a paragraph over 60 words, a `#` heading or a second Tip;
- a how-to lacks its time estimate, numbered steps or `**Next:**` link, or a Next link's text isn't the target's title;
- an internal link or anchor is broken, or a redirect points nowhere or shadows a live link;
- a shown image is missing its light or dark file, or an image is shown nowhere;
- a Spark tool has no entry in `spark-tools.md`, or a Settings section has none in `settings.md`;
- `spark_docs` would clip the page list or a page (60 list items, 4,000 characters per section, 20,000 per answer).

## Measuring

There is no analytics service. Docs keeps searches that found nothing in the browser's local storage (the newest 30), and **Send feedback** lists the latest ten in the draft, where the user can read and delete them before sending. Review those lists when feedback arrives, and add the missing page, heading or wording.

Once a quarter, read `welcome.md` against the app and remove tasks that no longer exist.
