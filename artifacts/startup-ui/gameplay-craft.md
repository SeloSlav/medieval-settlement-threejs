# Gameplay material finish

The player-facing UI now shares the approved startup screen's ledger leather,
smoked oak, iron corner fittings, and carved heading rules. No new image assets
or texture downloads were introduced. All four files remain in
`public/assets/ui/startup-craft/` and are included in the production build.

## Scope

- Noble profile, settlement resources and popovers, calendar and time controls.
- Construction dock, building tray, road tools, placement controls, map-overlay menus and legends.
- Building/resource and villager inspectors, trading and labor panels, town reports and administration.
- Settings, game controls, rename and confirmation dialogs, messages and player tooltips.
- Development wheel, detail ledger, and available/learned/locked treatments.
- Military rail, order controls and card edging; existing unit artwork remains intact.
- First-person compass/placement and connection-recovery cards.

The debug menu and performance tools are excluded. Existing map artwork,
portraits, heraldry, woodcut building/unit art, the calendar illustration, and
tutorial paper remain unchanged.

## Implementation contract

`src/ui/gameplayCraft.css` is a final, player-scoped paint layer imported by
`src/main.ts`. It changes material backgrounds, colors, inward border images,
shadows and focus outlines. It does not own positions, dimensions, spacing,
type metrics, image cropping, visibility, hit targets, scrolling or breakpoints.
Existing state logic and semantic warning colors are retained.

`npm run test:gameplay-craft` checks the paint-only property contract, explicit
player scope, asset reuse, startup-tooltip exclusion, and state coverage.

## Verification

- Production build and TypeScript check passed. Vite reports the existing large-chunk warning.
- Startup finish, UI typography, development tree, military menu and new-world setup tests passed.
- Browser review at 1600×900, 1280×720 and 820×900: sampled element rectangles,
  fonts, padding, margins, border widths, display, overflow and pointer behavior
  were identical with the finish enabled and disabled.
- Fourteen recorded geometry comparisons passed, covering the HUD, construction,
  settings, development states, confirmation and rename dialogs.
- The real debug-menu fixture had zero differences across 65 elements in the
  returned computed-style and geometry comparison.
- Simulation-speed selection, military run/formation selection, and development
  unlocking were exercised in offline fixtures only; no game database was changed.

## Review

Run the Vite dev server and open `/scripts/fixtures/gameplay-craft.html` for the
production UI components without a world connection. The “Crafted finish”
checkbox enables direct before/after comparisons. Use Space on the focused
checkbox when testing menus that close on outside pointer clicks. “Hide review
controls” produces clean screenshots; reloading restores the review controls.

The existing development and military fixtures also load the new paint layer.

These previews use the offline production-component fixture, not a world render:

- [Gameplay HUD and construction tray](gameplay-hud.jpg)
- [Settings](gameplay-settings.jpg)
- [Developments](gameplay-developments.jpg)
