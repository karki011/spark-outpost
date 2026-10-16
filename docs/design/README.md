# Spark Outpost design kit

## What's inside

- `mockup/spark-outpost-mockup.html`: the full interactive prototype. It has onboarding, Home, Chats, Tickets, Settings, themes, the Blob Scout logo, and the provider mascots. Open it in any browser. It needs internet only for the Geist font; without it, it falls back to your system font.
- `mockup/BLOBATAR-LICENSE.txt`: MIT license for blobatar 2.7.0, which is bundled into the mockup for the provider and user mascots.
- `logo/`: Blob Scout logo files.
  - `blob-scout-mark.svg`: full color
  - `blob-scout-app-icon.svg`: 1024 × 1024 app icon
  - `blob-scout-favicon.svg`: browser tab, with a thicker antenna for small sizes
  - `blob-scout-mark-black.svg`, `blob-scout-mark-white.svg`: one color, with the eyes cut out
  - `blob-scout-lockup-dark.svg`, `blob-scout-lockup-light.svg`: mark with the "spark outpost" wordmark
  - `blob-scout-logo-guide.html`: the logo guide, with moods, colors, and usage rules
- `tickets/`: the Tickets + Home-brief reference plan (`TICKETS_SCREEN_PLAN.md`) and its two mockups, `tickets-mockup-inbox.html` and `home-brief-mockup.html`.
- `map/`: the Project Map design target. `project-map-mockup.html` is the mockup, built by `build-map-data.mjs` and loaded by `tests/browser/map-fixture.ts`. To compare the app with it, run `tests/browser/project-map.spec.ts` with `SPARK_SHOTS` set to an output folder.
- `mocks/calendar-mock.html`: the Calendar design mock in the real app shell (sample data only): Today with the day shape, a clickable week, a merged and filterable timeline, Protect this free block, Join and ⌘J, meeting prep; Home's Upcoming card; the island nudge and capture line; an agent's edit and floor cards in a chat; the Calendar connector card and first run; the proposed Notifications section; and every empty and error state from the Mock state bar. The design is in `docs/architecture/CALENDAR.md`. Address options: `?theme=dark`, `?view=home`, `chats` or `settings`, `?pane=notifications`, `?state=quiet`, `connect`, `denied`, `none`, `helper` or `web`, `?day=13`, `?time=565` (minutes after midnight), `?island=open`, `?select=standup`, `?protect=1`.
- `ux/spark-outpost-ux-flow.md`: the UX flow and interaction spec (still-general sections only; see the note in that file for screens it no longer covers).
- `ACCESSIBILITY.md`: the WCAG 2.2 AA colour, typography, focus, target and motion rules, and how `pnpm a11y:contrast` checks them.
- `RESPONSIVE.md`: the phone, tablet and touch queries, and where each lives.
- `accessibility-report.html`: per-theme contrast ratios before and after the AA pass, with swatches and pass/fail status.

Screenshots of shipped features (buttons, connectors, GitHub, inputs, MCP, models, reset, settings, Spark, Home, Tickets, etc.) were removed from this folder because they went stale. Regenerate them from the `*-shots` Playwright specs (`tests/browser/home-shots.spec.ts`, `tests/browser/spark-shots.spec.ts`) with `SPARK_SHOTS` set to an output folder.

## Tips

- The mockup saves your onboarding and theme in the browser. To see onboarding again, use Settings, then Profile, then Replay onboarding.
- To see the error states, paste an API key containing "bad", or try Codex's local CLI (it fails the first time).
- The lockup SVGs set the wordmark as live text in Bricolage Grotesque. Convert it to outlines in Figma or Illustrator before sharing widely.
- The UX spec uses Mermaid diagrams. They render on GitHub and in most Markdown viewers.

## Colors

- Glacier `#2BB39A`
- Spark `#F2B54A`
- Eyes and icon background `#0C0F12`
