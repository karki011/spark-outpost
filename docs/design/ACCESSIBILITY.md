# Accessibility rules

Spark Outpost targets **WCAG 2.2 AA** in every theme (Light, Graphite, Apricot, Void, Fjord, Moss, Lagoon, Plum, Sage, High contrast, and the system light and dark pair). This page lists the rules we enforce, where each one comes from, and how it is checked.

The per-theme before and after numbers are in [`accessibility-report.html`](accessibility-report.html).

## Sources

- **[WCAG]** W3C, Web Content Accessibility Guidelines 2.2: SC 1.4.1, 1.4.3, 1.4.4, 1.4.10, 1.4.11, 1.4.12, 2.3.3, 2.4.7, 2.4.11 and 2.5.8.
- **[UCLA]** UCLA Brand, [Accessibility: color and type](https://brand.ucla.edu/fundamentals/accessibility/color-type).
- **[IW]** Inclusive Web, [Accessible typography and font guidelines for UI designers](https://www.inclusiveweb.co/accessibility-resources/accessible-typography-font-guidelines-for-ui-designers).
- **[DUX]** DeveloperUX, [Best practices for accessible color contrast in UX](https://developerux.com/2025/07/28/best-practices-for-accessible-color-contrast-in-ux/).
- **[HUIT]** Harvard University IT, [Use sufficient color contrast](https://accessibility.huit.harvard.edu/use-sufficient-color-contrast). Harvard's server refused automated fetches, so its content wasn't reviewed here. The thresholds below come straight from WCAG, which that page summarises.
- **[Motion]** The team's "Good motion is invisible" rules.
- **[60-30-10]** The team's colour balance rule.
- **[Laws]** The team's five UX laws: Fitts, Hick, Jakob, Proximity and Von Restorff.

## Colour contrast

| Rule                                                                                                                   | Threshold                  | Source                  |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------- |
| Normal text, including muted and faint text, placeholders, chips, tooltips and code tokens                             | 4.5:1                      | WCAG 1.4.3, UCLA, IW, DUX |
| Large text: at least 24px, or at least 18.66px bold                                                                    | 3:1                        | WCAG 1.4.3, UCLA, DUX   |
| Icons, status dots, progress bars and the boundaries of form fields                                                    | 3:1 against what is next to them | WCAG 1.4.11        |
| Focus indicator                                                                                                        | 3:1, at least 2px          | WCAG 2.4.7, 2.4.11      |
| Disabled controls and pure decoration                                                                                  | Exempt, but recorded       | WCAG 1.4.3, DUX         |
| Colour is never the only cue. Errors, waiting, done, selected, links, and added or removed lines also get an icon, text, marker or shape | —                          | WCAG 1.4.1, UCLA, IW, DUX |
| Added and removed diff lines use hues at least 60° apart, as well as the + and − markers                               | 60° OKLCH hue              | WCAG 1.4.1 (our rule)   |

### Token roles

Keep feature CSS on these tokens and never hard-code palette values (see `AGENTS.md`).

| Token                          | Use for                                                        | Guarantee                                                            |
| ------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| `--text`                       | Body copy                                                      | ≥ 4.5:1 on every surface                                             |
| `--muted`                      | Secondary copy and metadata                                    | ≥ 4.5:1 on every surface and tinted card                             |
| `--faint`                      | Tertiary metadata, placeholders, line numbers                  | ≥ 4.5:1 on every surface, including selected rows                    |
| `--accent`                     | Fills: primary buttons, active bars, progress, focus rings     | ≥ 3:1 on every surface; `--accent-ink` on it ≥ 4.5:1                 |
| `--accent-text`                | Accent-coloured text and icons, links                          | ≥ 4.5:1 on surfaces and on `--accent-soft`                           |
| `--warn`, `--danger`           | Status text, icons and fills                                   | ≥ 4.5:1 as text                                                      |
| `--warn-ink`                   | Text on a `--warn` fill (count badges)                         | ≥ 4.5:1                                                              |
| `--success`                    | Added lines, added counts                                      | ≥ 4.5:1 as text; hue ≥ 60° from `--danger`                           |
| `--line`                       | Decorative dividers (not needed to identify a control)         | Not enforced                                                         |
| `--line-strong`                | Borders of text inputs and the composer                        | ≥ 3:1 against canvas, panel and raise                                |

Use `color: var(--accent-text)`, not `var(--accent)`, whenever accent colour is used for text or `currentColor` icons.

### Lagoon, Plum and Sage

These three themes follow Apricot's recipe: tinted surfaces instead of neutral grey, one confident accent, a rail that sits one step deeper than the canvas, and a raised tone between canvas and panel. Each block in `theme.css` defines every token itself, including `--scout-eye`, the scrollbar thumbs, `--r` and `--r-sm`, so nothing falls back to another theme's colours. The diff, Shiki code-token and terminal colours derive from these tokens.

| Theme  | Mood                         | Canvas / rail / panel           | Accent (fill / text)  | Success / danger, hue gap |
| ------ | ---------------------------- | ------------------------------- | --------------------- | ------------------------- |
| Lagoon | Cool sea-glass light         | `#e8f2f1` / `#dae9e7` / `#fbfefe` | `#0a7389` / `#00657a` | `#17713c` / `#b7302f`, 126° |
| Plum   | Dusky dark, rose-gold jewel  | `#150f17` / `#0e0a10` / `#1c1520` | `#e9ab8c` / `#efb89c` | `#86d4a6` / `#ff7a8a`, 143° |
| Sage   | Soft warm-neutral, clay      | `#ecefe4` / `#e0e6d5` / `#fbfcf8` | `#a85a2a` / `#904a1f` | `#2c6e3a` / `#b3263f`, 131° |

All three pass every pair in `pnpm a11y:contrast` with only the standard allowlist exempt.

### Automated check

`pnpm a11y:contrast` (part of `pnpm check`) resolves the tokens for every theme from `apps/web/public/theme.css`, `chat/approvals/diff-view.css` and `chat/markdown/code-tokens.css`. It composites the translucent layers (`color-mix`, `rgba`), then checks 110 text and UI pairings plus one hue check per theme. It prints a table per theme and exits non-zero on any failure. The pairings are listed in `scripts/contrast/*-pairs.ts`. When a feature puts text on a new surface, add a pair for it.

The allowlist in `scripts/contrast/pairs.ts` is deliberately short, and every entry gives its reason:

- `disabled.button-label` and `disabled.button-ghost`: disabled controls, exempt under WCAG 1.4.3.
- `offline.zz`: the decorative, `aria-hidden` "z" glyphs on the offline mascot.

`tests/browser/accessibility.spec.ts` runs axe-core on the main screens in all ten themes. It fails on any serious or critical `color-contrast` or `aria-*` violation.

## Typography

| Rule                                                                                                                                  | Source             |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Body text is 15px with line-height 1.6. UCLA and IW recommend 16px; 15px Geist is kept for density and is paired with the higher line-height. | UCLA, IW           |
| No UI text below 12px: metadata, chips, keyboard hints and badges are all 12px or larger.                                             | IW (11px is "too small") |
| Line-height is at least 1.5 for body and chat text, and paragraph spacing (0.8em) is larger than the gap between lines.               | IW, WCAG 1.4.12    |
| Chat paragraphs and lists are capped at 75ch. Code blocks and tables keep the full width.                                             | IW (45–75 characters) |
| No all-caps for running text. Keep letter-spacing at 0 or slightly negative for large headings only, and don't space out small labels. | UCLA, IW           |
| Use `font-variant-numeric: tabular-nums` for counts, timers and costs, so that changing numbers don't shift the layout.               | Our rule           |
| Layouts survive 200% zoom (a 640px-wide viewport) without horizontal scrolling.                                                       | WCAG 1.4.4, 1.4.10, UCLA |
| Labels survive the WCAG 1.4.12 text-spacing override without clipping.                                                               | WCAG 1.4.12        |
| Placeholder text is never the only label for a field.                                                                                 | IW                 |

## Focus and targets

- Every interactive element shows a focus ring that is at least 2px of `--accent` and at least 3:1. The global `:focus-visible` outline covers most controls. Inputs that draw their own ring use a 1px accent border plus a 1px accent shadow, which makes 2px. Menu items keep the outline rather than relying on a hover tint.
- Targets are at least 24×24px (WCAG 2.5.8), and a browser test enforces this on the chat screen. Following Fitts's law, key actions are larger: Send, New chat and primary buttons are at least 32px tall.

## Motion

| Rule                                                                                                                                                                 | Source |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| UI entrances and exits last 150–250ms. Nothing in the UI chrome runs longer than 250ms.                                                                              | Motion |
| Use an ease-out curve (`--out`).                                                                                                                                     | Motion |
| No overshoot. `--spring` is reserved for the delight zones: Agent TV, the offline screen, and the small drag-and-drop reactions in the sidebar.                    | Motion |
| Popovers and menus scale from the edge nearest their trigger (`transform-origin`).                                                                                   | Motion |
| Reduced motion means fade, not fly: transforms are dropped, opacity fades stay, and decorative loops stop.                                                          | Motion, WCAG 2.3.3 |
| Animate `transform` and `opacity` only, never `width`, `height`, `left` or `top`.                                                                                   | Motion |

## Colour balance and UX laws

- **60-30-10:** about 60% neutral base (canvas, panel), 30% secondary (raise, rail, text greys), and 10% accent. Keep the accent for the primary call to action, the active item and key status. Routine confirmations use neutral chips; the "Allowed" task tag, for example, is neutral.
- **Fitts:** make key actions large and close to where the eye already is.
- **Hick:** keep choices few. Put secondary actions behind a menu.
- **Jakob:** use familiar patterns: green for added lines and red for removed, underlined links, and standard tab and dialog semantics.
- **Proximity:** keep a control next to the thing it changes.
- **Von Restorff:** only one thing should stand out on each screen, such as the approval waiting for you or the error. Everything else stays calm.

## Known exceptions and follow-ups

- **Delight zones:** Agent TV and the offline screen keep springs, longer loops and the `ow-poke` animation of `left`. Under reduced motion, their loops stop.
- **Sidebar drag and drop:** the lifted copy of the row scales up slightly, its blob wiggles when the drop target changes, the card bounces a little when it lands in a new project, and that project's header pulses. The dragged row stays in the list as a faded ghost at the spot where it will land, and its neighbours slide apart in 200ms. Each reaction stays under 250ms and uses transform and opacity only. Under reduced motion the card only fades, the neighbours move without sliding, and the header only glows.
- **Drag handles:** every draggable chat and project has a Move button that starts a keyboard drag. Up and down arrows choose the spot, right and left arrows move a chat into the project above or out to Chats, Space or Enter drops, and Escape cancels. A live region announces each step.
- **Scout mascot:** the hop and squish springs play only when the mascot is poked or happy.
- **Theme switch:** the circular reveal (650ms, `theme/reveal.ts`) runs longer than 250ms and doesn't use ease-out. It is skipped under reduced motion.
- **Spinners:** they keep rotating under reduced motion because they show progress.
- **Sidebar:** the collapse and expand animation and the resize handle are being reworked to the motion rules separately.
- **Error dot:** the sidebar's error dot draws its `!` glyph at 10px inside a 14px circle. The glyph gives it a shape cue, and the status element has an accessible label.
- **Agent TV:** labels are sized in `em` relative to the stage scale, and the smallest reaches about 11px at the default scale.

