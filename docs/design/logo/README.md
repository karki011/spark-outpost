# Spark Outpost logo

Two marks. **Scout** is the logo: the app icon, the Dock, the menu bar, the island, the website and every connector avatar. The **Outpost mark** is secondary: the O in the wordmark, the patch, stickers.

## Scout

A keep-shaped body with a flat base, two eyes, and an antenna that carries a gold ember. The ember is a rounded diamond, never a four-point sparkle. The shapes live in `packages/contracts/src/scout-shape.ts`; every drawing of Scout uses them, and `pnpm --filter ./apps/desktop icons` builds the app icons from them.

| File | Use |
| --- | --- |
| `blob-scout-mark.svg` | Full colour, on dark |
| `blob-scout-app-icon.svg` | 1024 × 1024 app icon |
| `blob-scout-favicon.svg` | Browser tab, thicker antenna |
| `blob-scout-mark-black.svg`, `blob-scout-mark-white.svg` | One colour, eyes cut out |
| `blob-scout-lockup-dark.svg`, `blob-scout-lockup-light.svg` | Mark with the wordmark |

## Outpost mark

A fort seen from above: four walls, four corner bastions, an ember in the courtyard.

| File | Use |
| --- | --- |
| `outpost-mark.svg` | Full colour, on dark |
| `outpost-mark-on-light.svg` | Full colour, on light |
| `outpost-mark-small.svg` | 32 px and below: thicker walls, larger ember |
| `outpost-mark-black.svg`, `outpost-mark-white.svg` | One colour |

In the wordmark the mark stands for the O of Outpost, at the height of the capital letters. Below 20 px, set the name in plain letters with a mark in front.

## Colour

Logo colours are fixed. The app theme never changes them.

| | On dark | On light | Contrast on its background |
| --- | --- | --- | --- |
| Teal | `#2bb39a` | `#177864` | 6.9 : 1 on `#14191d`, 4.8 : 1 on `#f6f1ed` |
| Gold | `#f2b54a` | `#b7791f` | 10 : 1 on `#14191d`, 3.3 : 1 on `#f6f1ed` |
| Ink (eyes, plate) | `#0c0f12` | `#0c0f12` | |

Use the on-dark pair on dark backgrounds and the on-light pair on light ones. Where neither works, use the one-colour black or white file. A small glyph inside the interface (menu bar, an inline icon) is one colour and takes the text colour around it.

## Space and size

- Clear space: keep a margin of one eye-height of Scout (one ember-width of the Outpost mark) free on every side.
- Smallest Scout: 16 px, using the favicon or the menu bar template. Smallest Outpost mark: 16 px, using the small cut.

## Motion

Scout and the ember may move only where they show status: the Dock, the menu bar, the island and inside the app. Everywhere else the logo is still. Reduce Motion keeps it still everywhere.

## Do not

- Recolour, tint with the theme, or use the on-dark colours on a light background.
- Put the four-point sparkle back on the antenna.
- Stretch, rotate, outline, add a shadow or a glow.
- Place either mark on a photo or a busy background without its dark plate.
- Use a blob drawn by the blobatar library as the logo. Those are Sparks and providers, not the brand.
