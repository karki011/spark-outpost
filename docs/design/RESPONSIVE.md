# Phone and tablet layout rules

One set of queries decides the layout. CSS has no custom media in this build (Vite's default CSS pipeline, and `public/*.css` is served as written), so the queries are written out and `pnpm check:source` refuses any other phone-width query in `apps/web`.

## Queries

| Name   | Query                                                              | Use                                                                 |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Phone  | `(max-width: 640px), (max-height: 500px) and (pointer: coarse)`    | The phone shell: bottom tab bar, chat drawer, sheets, tab-strip Settings. A phone on its side matches through the second half. |
| Not phone | `not ((max-width: 640px) or ((max-height: 500px) and (pointer: coarse)))` | Desktop-only rules that must not reach a phone.                    |
| Tablet | `(max-width: 899px)`                                               | Narrower than the Mac app can get (its window stops at 900px): stack two-column pages. |
| Dock   | `(min-width: 1101px)`                                              | The Work panel may dock. Below 1280px it docks only while the chat sidebar is hidden; `tasks/work-panel-state.ts` decides and marks an overlaid panel with `.over`. |
| Touch  | `(pointer: coarse)`                                                | Finger-sized targets and 16px inputs (`ui/touch.css`).              |
| No hover | `(hover: none)`                                                  | Show hover-only controls, hide key hints.                           |

JavaScript reads the same queries from `apps/web/src/ui/breakpoints.ts` (`usePhone`, `useMediaQuery`). Do not write a width in a `matchMedia` call anywhere else.

Layout steps inside the desktop range (1000, 1180, 1240, 1300px), container queries, and the island window's own rule are not phone rules and stay where they are.

## Touch

- Shared controls keep their drawn size and get a 44px hit area from a `::before` in `ui/touch.css`. Add a new small control's class to that list instead of sizing it by hand.
- Text inputs are 16px on touch so iOS does not zoom the page on focus.
- A control that appears on hover needs a line in the `(hover: none)` rule of the file that hides it, or in `ui/touch.css` when it is shared.

## Viewport

- The shell is `100dvh` tall. Popover and sheet heights use `dvh`, not `vh`.
- `viewport-fit=cover` is on: the phone shell pads itself with `env(safe-area-inset-*)` (app top and sides, tab bar, drawer, sheets, full-screen dialogs).
- `ui/viewport-clamp.ts` keeps a popover on screen. `usePopover` applies it; `MenuShell` uses the same clamp for context menus.
- While the on-screen keyboard is open (`app/touch-viewport.ts`), the tab bar hides and the shell shrinks to the visible height.

## Checks

`tests/browser/responsive-shell.spec.ts` and `responsive-chat.spec.ts` run at 390x844, 844x390, 820x1180 and 1180x820 with touch. Set `SPARK_SHOTS` to a folder to keep screenshots.
